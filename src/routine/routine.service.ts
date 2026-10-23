import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { HelperService } from '../helper/helper.service';
import { PlaylistService } from '../playlist/playlist.service';
import { SettingsService } from '../settings/settings.service';
import { SpotifyApiService } from '../spotify-api/spotify-api.service';
import { CollectItem, parseTargetTags, planRoutine, QueueState, SongPlan } from './routine-planner';

type RoutineCache = {
    //UTC, wann die Routine zuletzt gelaufen ist
    last_run_at: string | null;
    //Inhalt jeder Queue beim letzten Lauf, darüber wird erkannt, ob ein Song aus einer Queue entfernt wurde
    queues: Record<string, { uris: string[] }>;
};

type QueueMeta = {
    id: string;
    name: string;
    target_id: string;
};

/**
 * Die Queue-Routine: verschiebt Songs aus der Sammel-Playlist (BEHALTEN) in Liked Songs und in die Main ihrer Queue
 * die Entscheidungen trifft routine-planner.ts, hier passieren nur das Laden, das Ausführen und das Logging
 */
@Injectable()
export class RoutineService {
    private static readonly CACHE_FILE = 'routine.json';
    //läuft der PC länger, wird die Routine nach so vielen Stunden nochmal angestoßen
    private static readonly RUN_INTERVAL_HOURS = 20;
    //Limits der Spotify API pro Call
    private static readonly LIBRARY_BATCH_SIZE = 40;
    private static readonly PLAYLIST_BATCH_SIZE = 100;

    constructor(
        private readonly helperService: HelperService,
        private readonly playlistService: PlaylistService,
        private readonly settingsService: SettingsService,
        private readonly spotifyApiService: SpotifyApiService,
    ) {}

    async isDue(): Promise<boolean> {
        const cache = await this.readCache();
        if (!cache.last_run_at) {
            return true;
        }
        const hours_since_last_run =
            (Date.now() - Date.parse(cache.last_run_at)) / (60 * 60 * 1000);
        return hours_since_last_run >= RoutineService.RUN_INTERVAL_HOURS;
    }

    async run() {
        const settings = await this.settingsService.getSettings();
        if (!settings.routine_enabled) {
            this.helperService.printWithTimestamp('Routine is disabled in settings.json');
            return;
        }
        const is_dry_run = settings.routine_dry_run;
        const prefix = is_dry_run ? '[Routine][DRY RUN]' : '[Routine]';
        const log = (message: string, is_error: boolean = false) =>
            this.helperService.printWithTimestamp(`${prefix} ${message}`, is_error);
        const calls_before = this.spotifyApiService.getCallCount();
        const cache = await this.readCache();

        //1. alle eigenen Playlists holen, darin die Queues über ihren Tag finden
        const own_playlists = await this.playlistService.getOwnPlaylists();
        const own_by_id = new Map<string, any>(
            own_playlists.map((playlist) => [playlist.id, playlist]),
        );
        const collect_id = settings.collect_playlist_id;
        const fallback_id = settings.fallback_playlist_id;
        if (!own_by_id.has(collect_id) || !own_by_id.has(fallback_id)) {
            log(
                `Collect playlist (${collect_id}) or fallback playlist (${fallback_id}) not found, check settings.json`,
                true,
            );
            return;
        }
        const queue_metas = this.detectQueues(own_playlists, [collect_id, fallback_id], log);
        const valid_target_ids = new Set(
            queue_metas.map((queue) => queue.target_id).filter((id) => own_by_id.has(id)),
        );

        //2. Queue-Inhalte laden, immer komplett neu
        //die snapshot_id taugt nicht als Änderungs-Check, Spotify liefert nach Änderungen teils minutenlang die alte
        const queues: QueueState[] = [];
        for (const meta of queue_metas) {
            const cached = cache.queues[meta.id];
            const uris = await this.getPlaylistURIs(meta.id);
            queues.push({
                id: meta.id,
                name: meta.name,
                target_id: meta.target_id,
                uris: new Set(uris),
                previous_uris: cached ? new Set(cached.uris) : null,
            });
        }

        //3. Sammel-Playlist lesen
        const collect_items = await this.getCollectItems(collect_id, log);
        if (collect_items.length === 0) {
            log(`${own_by_id.get(collect_id).name} is empty (${queues.length} queues checked)`);
            await this.saveCache(cache, queues, new Map(), is_dry_run);
            return;
        }
        log(`${collect_items.length} songs in ${own_by_id.get(collect_id).name}`);

        //4. Inhalte der Playlists laden, die für die Entscheidung gebraucht werden (Duplikate, "schon in einer Main")
        const playlist_contents = new Map<string, Set<string>>();
        for (const playlist_id of this.getNeededPlaylists(
            collect_items,
            queues,
            valid_target_ids,
            fallback_id,
        )) {
            playlist_contents.set(playlist_id, new Set(await this.getPlaylistURIs(playlist_id)));
        }

        //5. entscheiden
        const plans = planRoutine({
            collect_items,
            queues,
            valid_target_ids,
            playlist_contents,
            fallback_id,
        });
        const name_of = (id: string) => own_by_id.get(id)?.name ?? id;
        for (const plan of plans) {
            log(this.describePlan(plan, name_of), plan.warning !== null);
        }

        //6. ausführen
        const failed_uris = new Set<string>();
        if (!is_dry_run) {
            await this.execute(plans, collect_id, failed_uris, log);
        }

        //7. Cache aktualisieren
        const removed_by_queue = new Map<string, Set<string>>();
        for (const plan of plans) {
            if (is_dry_run || failed_uris.has(plan.uri)) {
                continue;
            }
            for (const queue_id of plan.remove_from_queue_ids) {
                if (!removed_by_queue.has(queue_id)) {
                    removed_by_queue.set(queue_id, new Set());
                }
                removed_by_queue.get(queue_id)!.add(plan.uri);
            }
        }
        await this.saveCache(cache, queues, removed_by_queue, is_dry_run);

        const done = plans.filter((plan) => plan.remove_from_collect && !failed_uris.has(plan.uri));
        log(
            `Done: ${is_dry_run ? 'would process' : 'processed'} ${done.length}, failed ${failed_uris.size}, ` +
                `skipped ${plans.length - done.length - failed_uris.size} ` +
                `(${this.spotifyApiService.getCallCount() - calls_before} API calls)`,
        );
    }

    /**
     * Schritte in sicherer Reihenfolge: Liken, ins Target, aus Queues löschen, aus BEHALTEN löschen
     * schlägt ein Schritt für einen Song fehl, werden seine weiteren Schritte übersprungen
     * er bleibt dann in BEHALTEN und wird beim nächsten Lauf nochmal versucht
     */
    private async execute(
        plans: SongPlan[],
        collect_id: string,
        failed_uris: Set<string>,
        log: (message: string, is_error?: boolean) => void,
    ) {
        const active = () => plans.filter((plan) => !failed_uris.has(plan.uri));

        //a) liken, aber nur was noch nicht geliked ist, sonst rutscht der Song in Liked Songs nach oben
        const like_uris = active()
            .filter((plan) => plan.like)
            .map((plan) => plan.uri);
        for (const batch of this.chunk(like_uris, RoutineService.LIBRARY_BATCH_SIZE)) {
            try {
                const is_liked: boolean[] = await this.spotifyApiService.sendGetCall(
                    'me/library/contains',
                    {
                        uris: batch.join(','),
                    },
                );
                const not_liked = batch.filter((_uri, index) => !is_liked[index]);
                if (not_liked.length > 0) {
                    await this.spotifyApiService.sendPutCall('me/library', null, {
                        uris: not_liked.join(','),
                    });
                }
            } catch (error) {
                log(`Liking failed: ${error}`, true);
                batch.forEach((uri) => failed_uris.add(uri));
            }
        }

        //b) ans Ende des Targets anhängen
        for (const [target_id, uris] of this.groupBy(
            active().filter((plan) => plan.target_id !== null && plan.add_to_target),
            (plan) => [plan.target_id!],
        )) {
            for (const batch of this.chunk(uris, RoutineService.PLAYLIST_BATCH_SIZE)) {
                try {
                    await this.spotifyApiService.sendPostCall(`playlists/${target_id}/items`, {
                        uris: batch,
                    });
                } catch (error) {
                    log(`Adding to ${target_id} failed: ${error}`, true);
                    batch.forEach((uri) => failed_uris.add(uri));
                }
            }
        }

        //c) aus den Queues löschen
        for (const [queue_id, uris] of this.groupBy(
            active(),
            (plan) => plan.remove_from_queue_ids,
        )) {
            for (const batch of this.chunk(uris, RoutineService.PLAYLIST_BATCH_SIZE)) {
                try {
                    await this.removeFromPlaylist(queue_id, batch);
                } catch (error) {
                    log(`Removing from queue ${queue_id} failed: ${error}`, true);
                    batch.forEach((uri) => failed_uris.add(uri));
                }
            }
        }

        //d) aus BEHALTEN löschen
        const collect_uris = active()
            .filter((plan) => plan.remove_from_collect)
            .map((plan) => plan.uri);
        for (const batch of this.chunk(collect_uris, RoutineService.PLAYLIST_BATCH_SIZE)) {
            try {
                await this.removeFromPlaylist(collect_id, batch);
            } catch (error) {
                log(`Removing from collect playlist failed: ${error}`, true);
                batch.forEach((uri) => failed_uris.add(uri));
            }
        }
    }

    /**
     * Löscht alle Vorkommen der Songs aus einer Playlist
     */
    private async removeFromPlaylist(playlist_id: string, uris: string[]): Promise<any> {
        return this.spotifyApiService.sendDeleteCall(`playlists/${playlist_id}/items`, {
            items: uris.map((uri) => ({ uri })),
        });
    }

    private detectQueues(
        own_playlists: any[],
        excluded_ids: string[],
        log: (message: string, is_error?: boolean) => void,
    ): QueueMeta[] {
        const queues: QueueMeta[] = [];
        for (const playlist of own_playlists) {
            if (excluded_ids.includes(playlist.id)) {
                continue;
            }
            const description = this.helperService.decodeHTMLEntities(playlist.description ?? '');
            const target_ids = parseTargetTags(description);
            if (target_ids.length > 1) {
                log(`Queue "${playlist.name}" has more than one tag, skipping it`, true);
            } else if (target_ids.length === 1 && target_ids[0] !== playlist.id) {
                queues.push({
                    id: playlist.id,
                    name: playlist.name,
                    target_id: target_ids[0],
                });
            }
        }
        return queues;
    }

    private async getCollectItems(
        collect_id: string,
        log: (message: string, is_error?: boolean) => void,
    ): Promise<CollectItem[]> {
        const items = await this.spotifyApiService.getAllPages(`playlists/${collect_id}/items`, {
            fields: 'next,items(is_local,item(uri,name,type,artists(name)))',
        });
        const collect_items: CollectItem[] = [];
        for (const entry of items) {
            const item = entry?.item;
            if (!item?.uri) {
                continue;
            }
            const label = `"${item.name}" – ${item.artists?.map((artist: any) => artist.name).join(', ') ?? '?'}`;
            if (!entry.is_local && item.type !== 'track') {
                log(`${label} is not a song (${item.type}), skipping it`, true);
                continue;
            }
            collect_items.push({ uri: item.uri, label, is_local: entry.is_local === true });
        }
        return collect_items;
    }

    private async getPlaylistURIs(playlist_id: string): Promise<string[]> {
        const items = await this.spotifyApiService.getAllPages(`playlists/${playlist_id}/items`, {
            fields: 'next,items(item(uri))',
        });
        return items.map((entry) => entry?.item?.uri).filter((uri): uri is string => !!uri);
    }

    /**
     * Fallback und die Mains aller Queues, in denen ein Song aus BEHALTEN liegt oder lag
     * liegt ein Song in gar keiner Queue, werden alle Mains geladen (für "schon in einer Main")
     */
    private getNeededPlaylists(
        collect_items: CollectItem[],
        queues: QueueState[],
        valid_target_ids: Set<string>,
        fallback_id: string,
    ): Set<string> {
        const needed = new Set<string>([fallback_id]);
        for (const item of collect_items) {
            const related = queues.filter(
                (queue) => queue.uris.has(item.uri) || queue.previous_uris?.has(item.uri),
            );
            if (related.length === 0) {
                valid_target_ids.forEach((id) => needed.add(id));
            }
            related
                .map((queue) => queue.target_id)
                .filter((id) => valid_target_ids.has(id))
                .forEach((id) => needed.add(id));
        }
        return needed;
    }

    private describePlan(plan: SongPlan, name_of: (id: string) => string): string {
        const queue_names = plan.origin_queue_ids.map(name_of).join(', ');
        const target = plan.target_id ? name_of(plan.target_id) : '';
        const already = plan.target_id && !plan.add_to_target ? ' (already there)' : '';
        const warning = plan.warning ? ` WARNING: ${plan.warning}` : '';
        switch (plan.origin) {
            case 'removed_by_user':
                return `${plan.label}: ${queue_names} (removed by you) → ${target}${already}${warning}`;
            case 'single_queue':
                return `${plan.label}: ${queue_names} → ${target}${already}, removed from queue${warning}`;
            case 'same_project':
                return `${plan.label}: ${queue_names} → ${target}${already}, removed from all these queues${warning}`;
            case 'different_projects':
                return `${plan.label}: ${queue_names} (different projects) → ${target}${already}, removed from all these queues`;
            case 'no_queue':
                return `${plan.label}: in no queue → ${target}${already}`;
            case 'already_in_main':
                return `${plan.label}: in no queue, already in a main → only liked`;
            case 'local_file':
                return `${plan.label}: local file, stays in the collect playlist, please move it by hand`;
        }
    }

    private async readCache(): Promise<RoutineCache> {
        try {
            return JSON.parse(await fs.readFile(RoutineService.CACHE_FILE, 'utf8')) as RoutineCache;
        } catch {
            return { last_run_at: null, queues: {} };
        }
    }

    /**
     * Im Dry-Run werden nur neue Queues in den Cache aufgenommen, bestehende Einträge bleiben stehen
     * sonst würde beim Umschalten auf scharf die Info "Haken entfernt" verloren gehen
     */
    private async saveCache(
        cache: RoutineCache,
        queues: QueueState[],
        removed_by_queue: Map<string, Set<string>>,
        is_dry_run: boolean,
    ) {
        const new_queues: RoutineCache['queues'] = {};
        for (const queue of queues) {
            if (is_dry_run && cache.queues[queue.id]) {
                new_queues[queue.id] = cache.queues[queue.id];
                continue;
            }
            const removed = removed_by_queue.get(queue.id) ?? new Set<string>();
            new_queues[queue.id] = { uris: [...queue.uris].filter((uri) => !removed.has(uri)) };
        }
        const new_cache: RoutineCache = {
            last_run_at: new Date().toISOString(),
            queues: new_queues,
        };
        await fs.writeFile(RoutineService.CACHE_FILE, JSON.stringify(new_cache));
    }

    private chunk<T>(items: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < items.length; i += size) {
            chunks.push(items.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * Gruppiert die URIs der Pläne nach Playlist, z.B. alle Songs, die in dieselbe Main kommen
     */
    private groupBy(
        plans: SongPlan[],
        keys_of: (plan: SongPlan) => string[],
    ): Map<string, string[]> {
        const groups = new Map<string, string[]>();
        for (const plan of plans) {
            for (const key of keys_of(plan)) {
                if (!groups.has(key)) {
                    groups.set(key, []);
                }
                groups.get(key)!.push(plan.uri);
            }
        }
        return groups;
    }
}
