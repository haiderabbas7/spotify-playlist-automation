import { Injectable } from '@nestjs/common';
import { SpotifyApiService } from '../spotify-api/spotify-api.service';
import { HelperService } from '../helper/helper.service';
import {
    countBlocked,
    pickRandomAlbum,
    removeExpiredBlocks,
    SavedAlbum,
    toSavedAlbum,
} from './random-album-picker';

export type RandomAlbumResponse = {
    album: SavedAlbum | null;
    seen_count: number;
    total: number;
    deck_reset: boolean;
    //set if reloading the library failed and the old list was used
    warning: string | null;
};

@Injectable()
export class RandomAlbumService {
    //the saved albums are loaded again on the next pick once the list is older than this
    private static readonly CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
    //after a failed reload the old list is used for this long, so not every pick waits for Spotify again
    private static readonly RETRY_AFTER_FAILURE_MS = 10 * 60 * 1000;

    private albums: SavedAlbum[] | null = null;
    private reload_due_at: number = 0;
    //loading in progress, so parallel requests (e.g. two tabs) do not load the library twice
    private loading_in_progress: Promise<SavedAlbum[]> | null = null;
    //album id => time it was shown, kept in memory only, so a restart clears all blocks
    private readonly blocked: Map<string, number> = new Map();

    constructor(
        private readonly spotifyApiService: SpotifyApiService,
        private readonly helperService: HelperService,
    ) {}

    /**
     * Picks the next random album and blocks it for 8 hours
     * exclude_id: album that must not be picked, e.g. the one currently on screen
     * reload: loads the library again and clears all blocks (only if loading worked)
     */
    async pickNext(exclude_id: string | null, reload: boolean): Promise<RandomAlbumResponse> {
        const { albums, warning } = await this.getAlbums(reload);
        if (reload && warning === null) {
            this.blocked.clear();
        }
        const now = Date.now();
        const { album, deck_reset } = pickRandomAlbum(
            albums,
            this.blocked,
            exclude_id,
            now,
            (objects) => this.helperService.getWeightedRandom(objects),
        );
        if (album !== null) {
            this.blocked.set(album.id, now);
        }
        return {
            album,
            seen_count: countBlocked(albums, this.blocked),
            total: albums.length,
            deck_reset,
            warning,
        };
    }

    /**
     * Releases the block of an album, used when going back to it with "Back"
     * returns the new number of seen albums for the counter
     */
    unblock(album_id: string): { seen_count: number } {
        this.blocked.delete(album_id);
        removeExpiredBlocks(this.blocked, Date.now());
        return { seen_count: countBlocked(this.albums ?? [], this.blocked) };
    }

    /**
     * The cached list, loaded again once reload_due_at has passed or if force is set
     * if loading fails but an old list exists, the old list is used and a warning is returned
     */
    private async getAlbums(
        force: boolean,
    ): Promise<{ albums: SavedAlbum[]; warning: string | null }> {
        if (this.albums !== null && Date.now() < this.reload_due_at && !force) {
            return { albums: this.albums, warning: null };
        }
        try {
            return { albums: await this.loadAlbums(), warning: null };
        } catch (error) {
            if (this.albums === null) {
                throw error;
            }
            this.helperService.printWithTimestamp(
                `[RandomAlbum] Reloading saved albums failed, using the old list: ${String(error)}`,
                true,
            );
            this.reload_due_at = Date.now() + RandomAlbumService.RETRY_AFTER_FAILURE_MS;
            return {
                albums: this.albums,
                warning: 'Could not reload your albums from Spotify, showing the saved list',
            };
        }
    }

    /**
     * Loads all saved albums, only once at a time
     */
    private loadAlbums(): Promise<SavedAlbum[]> {
        if (this.loading_in_progress === null) {
            this.loading_in_progress = this.loadAlbumsFromSpotify().finally(() => {
                this.loading_in_progress = null;
            });
        }
        return this.loading_in_progress;
    }

    private async loadAlbumsFromSpotify(): Promise<SavedAlbum[]> {
        const start = Date.now();
        const items = await this.spotifyApiService.getAllPages('me/albums', { limit: 50 });
        //Spotify can return empty items for albums that are no longer available
        this.albums = items.filter((item) => item?.album?.id).map((item) => toSavedAlbum(item));
        this.reload_due_at = Date.now() + RandomAlbumService.CACHE_DURATION_MS;
        this.helperService.printWithTimestamp(
            `[RandomAlbum] Loaded ${this.albums.length} saved albums in ${this.helperService.getFormattedStringForDuration(Date.now() - start)}`,
        );
        return this.albums;
    }
}
