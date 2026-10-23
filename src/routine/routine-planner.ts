/**
 * Entscheidungslogik der Queue-Routine, komplett ohne Spotify-Calls
 * dadurch lässt sie sich mit Jest testen (routine-planner.spec.ts)
 */

export type CollectItem = {
    uri: string;
    //für das Log, z.B. "Song - Artist"
    label: string;
    is_local: boolean;
};

export type QueueState = {
    id: string;
    name: string;
    target_id: string;
    //Inhalt jetzt
    uris: Set<string>;
    //Inhalt beim letzten Lauf, null wenn die Queue noch nie gesehen wurde
    previous_uris: Set<string> | null;
};

export type PlannerInput = {
    collect_items: CollectItem[];
    queues: QueueState[];
    //Targets, die existieren und Haider gehören
    valid_target_ids: Set<string>;
    //Inhalte der geladenen Mains und von EINSORTIEREN, fehlt eine Playlist hier, gilt sie als leer
    playlist_contents: Map<string, Set<string>>;
    fallback_id: string;
};

export type SongOrigin =
    //Haken bei der Queue entfernt, seit dem letzten Lauf aus genau diesen Queues verschwunden
    | 'removed_by_user'
    //liegt in genau einer Queue
    | 'single_queue'
    //liegt in mehreren Queues mit derselben Main
    | 'same_project'
    //liegt in Queues mit verschiedenen Mains
    | 'different_projects'
    //liegt in keiner Queue
    | 'no_queue'
    //liegt in keiner Queue, ist aber schon in einer Main
    | 'already_in_main'
    //Local File, kann die API nicht verschieben
    | 'local_file';

export type SongPlan = {
    uri: string;
    label: string;
    origin: SongOrigin;
    //Queues, aus denen der Song kam (fürs Log)
    origin_queue_ids: string[];
    //null: in keine Playlist einfügen (nur liken)
    target_id: string | null;
    //false, wenn der Song schon im Target liegt (keine Duplikate)
    add_to_target: boolean;
    remove_from_queue_ids: string[];
    like: boolean;
    remove_from_collect: boolean;
    //z.B. wenn das Target einer Queue nicht mehr existiert
    warning: string | null;
};

export function planRoutine(input: PlannerInput): SongPlan[] {
    const plans: SongPlan[] = [];
    const seen_uris = new Set<string>();
    const target_ids = new Set(input.queues.map((queue) => queue.target_id));

    for (const item of input.collect_items) {
        //gleicher Song mehrfach in BEHALTEN wird nur einmal verarbeitet
        if (seen_uris.has(item.uri)) {
            continue;
        }
        seen_uris.add(item.uri);

        if (item.is_local || item.uri.startsWith('spotify:local:')) {
            plans.push({
                uri: item.uri,
                label: item.label,
                origin: 'local_file',
                origin_queue_ids: [],
                target_id: null,
                add_to_target: false,
                remove_from_queue_ids: [],
                like: false,
                remove_from_collect: false,
                warning: 'Local File, bitte von Hand verschieben',
            });
            continue;
        }

        plans.push(planSong(item, input, target_ids));
    }
    return plans;
}

function planSong(item: CollectItem, input: PlannerInput, target_ids: Set<string>): SongPlan {
    const removed_by_user = input.queues.filter(
        (queue) => queue.previous_uris?.has(item.uri) && !queue.uris.has(item.uri),
    );
    const containing = input.queues.filter((queue) => queue.uris.has(item.uri));

    let origin: SongOrigin;
    let origin_queues: QueueState[];
    let remove_from: QueueState[];

    if (removed_by_user.length > 0) {
        //Herkunft ist sicher, in anderen Queues bleibt der Song liegen
        origin = 'removed_by_user';
        origin_queues = removed_by_user;
        remove_from = [];
    } else if (containing.length === 1) {
        origin = 'single_queue';
        origin_queues = containing;
        remove_from = containing;
    } else if (containing.length > 1) {
        const distinct_targets = new Set(containing.map((queue) => queue.target_id));
        origin = distinct_targets.size === 1 ? 'same_project' : 'different_projects';
        origin_queues = containing;
        remove_from = containing;
    } else {
        const is_in_some_main = [...target_ids].some((target_id) =>
            input.playlist_contents.get(target_id)?.has(item.uri),
        );
        origin = is_in_some_main ? 'already_in_main' : 'no_queue';
        origin_queues = [];
        remove_from = [];
    }

    let target_id: string | null;
    let warning: string | null = null;
    if (origin === 'already_in_main') {
        target_id = null;
    } else if (origin === 'no_queue' || origin === 'different_projects') {
        target_id = input.fallback_id;
    } else {
        const origin_targets = [...new Set(origin_queues.map((queue) => queue.target_id))];
        if (origin_targets.length > 1) {
            //nur möglich, wenn der Haken bei Queues verschiedener Projekte entfernt wurde
            target_id = input.fallback_id;
        } else if (!input.valid_target_ids.has(origin_targets[0])) {
            target_id = input.fallback_id;
            warning = `Main ${origin_targets[0]} nicht gefunden oder gehört dir nicht, Tag in der Queue prüfen`;
        } else {
            target_id = origin_targets[0];
        }
    }

    return {
        uri: item.uri,
        label: item.label,
        origin,
        origin_queue_ids: origin_queues.map((queue) => queue.id),
        target_id,
        add_to_target: target_id !== null && !input.playlist_contents.get(target_id)?.has(item.uri),
        remove_from_queue_ids: remove_from.map((queue) => queue.id),
        like: true,
        remove_from_collect: true,
        warning,
    };
}

/**
 * Liest die Target-Tags aus einer Queue-Beschreibung, z.B. {spotify:playlist:0BfYlDPlZlFpDlJxxGNGWi} oder {0BfYlDPlZlFpDlJxxGNGWi}
 * leeres Array: kein Tag, also keine Queue. Mehr als eine ID: ungültig, die Queue wird übersprungen
 */
export function parseTargetTags(description: string): string[] {
    const matches = description.matchAll(/\{\s*(?:spotify:playlist:)?([A-Za-z0-9]{22})\s*\}/g);
    return [...new Set([...matches].map((match) => match[1]))];
}
