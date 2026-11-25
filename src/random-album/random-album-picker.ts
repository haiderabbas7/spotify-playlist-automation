/**
 * Pure decision logic of the random album page, without Spotify calls, so it can be unit tested
 */

export type SavedAlbum = {
    id: string;
    name: string;
    artists: string;
    release_year: string;
    total_tracks: number;
    cover_url: string | null;
    //ISO date from Spotify, when the album was saved to the library
    added_at: string;
};

export type PickResult = {
    album: SavedAlbum | null;
    //true if every album was blocked, so all blocks were cleared before picking
    deck_reset: boolean;
};

//an album that was shown is not picked again for this long
export const BLOCK_DURATION_MS = 8 * 60 * 60 * 1000;
//albums saved within this time are half as likely as older ones
export const RECENT_DURATION_MS = 21 * 24 * 60 * 60 * 1000;
const RECENT_WEIGHT = 1;
const DEFAULT_WEIGHT = 2;

/**
 * Turns one item of GET me/albums into a SavedAlbum
 */
export function toSavedAlbum(item: any): SavedAlbum {
    const album = item.album;
    return {
        id: album.id,
        name: album.name,
        artists: (album.artists ?? []).map((artist: any) => artist.name).join(', '),
        //release_date is "1999", "1999-05" or "1999-05-01" depending on its precision
        release_year: String(album.release_date ?? '').substring(0, 4),
        total_tracks: album.total_tracks,
        //images are sorted by size, largest first
        cover_url: album.images?.[0]?.url ?? null,
        added_at: item.added_at,
    };
}

/**
 * Weight for the weighted random pick: recently saved albums count half
 */
export function getAlbumWeight(album: SavedAlbum, now: number): number {
    const saved_at = Date.parse(album.added_at);
    return now - saved_at < RECENT_DURATION_MS ? RECENT_WEIGHT : DEFAULT_WEIGHT;
}

/**
 * Removes all blocks that are older than BLOCK_DURATION_MS (blocked maps album id => time it was shown)
 */
export function removeExpiredBlocks(blocked: Map<string, number>, now: number) {
    for (const [album_id, shown_at] of blocked) {
        if (now - shown_at >= BLOCK_DURATION_MS) {
            blocked.delete(album_id);
        }
    }
}

/**
 * Number of albums of the library that are currently blocked
 */
export function countBlocked(albums: SavedAlbum[], blocked: Map<string, number>): number {
    return albums.filter((album) => blocked.has(album.id)).length;
}

/**
 * Picks a random album that is not blocked and not excluded (e.g. the album currently on screen)
 * weighted_random is the weighted roulette, passed in so the shuffler's implementation can be reused
 * if every candidate is blocked, the blocks are cleared and the pick starts over
 * (the excluded album keeps its block, it was just shown)
 * the picked album is NOT blocked here, the caller does that
 */
export function pickRandomAlbum(
    albums: SavedAlbum[],
    blocked: Map<string, number>,
    exclude_id: string | null,
    now: number,
    weighted_random: <T extends { weight: number }>(objects: T[]) => T | undefined,
): PickResult {
    removeExpiredBlocks(blocked, now);
    if (albums.length === 0) {
        return { album: null, deck_reset: false };
    }
    let deck_reset = false;
    let candidates = albums.filter((album) => !blocked.has(album.id) && album.id !== exclude_id);
    if (candidates.length === 0) {
        const excluded_shown_at = exclude_id === null ? undefined : blocked.get(exclude_id);
        blocked.clear();
        if (exclude_id !== null && excluded_shown_at !== undefined) {
            blocked.set(exclude_id, excluded_shown_at);
        }
        deck_reset = true;
        candidates = albums.filter((album) => album.id !== exclude_id);
        //the library only has the excluded album, show it anyway instead of nothing
        if (candidates.length === 0) {
            candidates = albums;
        }
    }
    const weighted_candidates = candidates.map((album) => ({
        album,
        weight: getAlbumWeight(album, now),
    }));
    return { album: weighted_random(weighted_candidates)?.album ?? null, deck_reset };
}
