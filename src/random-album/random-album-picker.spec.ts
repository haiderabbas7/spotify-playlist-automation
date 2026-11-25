import {
    BLOCK_DURATION_MS,
    countBlocked,
    getAlbumWeight,
    pickRandomAlbum,
    RECENT_DURATION_MS,
    SavedAlbum,
    toSavedAlbum,
} from './random-album-picker';
import { HelperService } from '../helper/helper.service';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const helperService = new HelperService();
const weighted_random = <T extends { weight: number }>(objects: T[]) =>
    helperService.getWeightedRandom(objects);

function album(id: string, added_days_ago: number = 100): SavedAlbum {
    return {
        id,
        name: id,
        artists: 'Artist',
        release_year: '2000',
        total_tracks: 10,
        cover_url: null,
        added_at: new Date(NOW - added_days_ago * DAY_MS).toISOString(),
    };
}

describe('toSavedAlbum', () => {
    it('takes the year from any release date precision, joins artists and picks the largest cover', () => {
        const result = toSavedAlbum({
            added_at: '2024-03-12T10:00:00Z',
            album: {
                id: 'abc',
                name: 'Album',
                artists: [{ name: 'A' }, { name: 'B' }],
                release_date: '1999-05',
                total_tracks: 12,
                images: [{ url: 'large' }, { url: 'small' }],
            },
        });
        expect(result).toEqual({
            id: 'abc',
            name: 'Album',
            artists: 'A, B',
            release_year: '1999',
            total_tracks: 12,
            cover_url: 'large',
            added_at: '2024-03-12T10:00:00Z',
        });
    });

    it('has no cover if Spotify sends no images', () => {
        const result = toSavedAlbum({
            added_at: '2024-03-12T10:00:00Z',
            album: { id: 'abc', name: 'Album', artists: [], release_date: '1999', images: [] },
        });
        expect(result.cover_url).toBeNull();
    });
});

describe('getAlbumWeight', () => {
    it('gives albums saved in the last 3 weeks half the weight of older ones', () => {
        const recent = getAlbumWeight(album('new', 20), NOW);
        const old = getAlbumWeight(album('old', 22), NOW);
        expect(old).toBe(2 * recent);
    });

    it('treats all older albums the same', () => {
        expect(getAlbumWeight(album('a', 30), NOW)).toBe(getAlbumWeight(album('b', 3000), NOW));
    });

    it('counts an album saved exactly 3 weeks ago as old', () => {
        const added_at = new Date(NOW - RECENT_DURATION_MS).toISOString();
        expect(getAlbumWeight({ ...album('a'), added_at }, NOW)).toBe(
            getAlbumWeight(album('b', 100), NOW),
        );
    });
});

describe('pickRandomAlbum', () => {
    it('never picks a blocked album', () => {
        const albums = [album('a'), album('b'), album('c')];
        const blocked = new Map([
            ['a', NOW - 1000],
            ['b', NOW - 1000],
        ]);
        for (let i = 0; i < 50; i++) {
            expect(pickRandomAlbum(albums, blocked, null, NOW, weighted_random).album?.id).toBe(
                'c',
            );
        }
    });

    it('never picks the excluded album', () => {
        const albums = [album('a'), album('b')];
        for (let i = 0; i < 50; i++) {
            expect(pickRandomAlbum(albums, new Map(), 'a', NOW, weighted_random).album?.id).toBe(
                'b',
            );
        }
    });

    it('releases blocks after 8 hours', () => {
        const albums = [album('a'), album('b')];
        const blocked = new Map([
            ['a', NOW - BLOCK_DURATION_MS],
            ['b', NOW - BLOCK_DURATION_MS + 1000],
        ]);
        const result = pickRandomAlbum(albums, blocked, null, NOW, weighted_random);
        expect(result.album?.id).toBe('a');
        expect(blocked.has('a')).toBe(false);
        expect(blocked.has('b')).toBe(true);
    });

    it('clears all blocks and starts over when every album was seen', () => {
        const albums = [album('a'), album('b'), album('c')];
        const blocked = new Map([
            ['a', NOW - 1000],
            ['b', NOW - 1000],
            ['c', NOW - 1000],
        ]);
        const result = pickRandomAlbum(albums, blocked, null, NOW, weighted_random);
        expect(result.deck_reset).toBe(true);
        expect(result.album).not.toBeNull();
        expect(blocked.size).toBe(0);
    });

    it('keeps the block of the album on screen when starting over', () => {
        const albums = [album('a'), album('b')];
        const blocked = new Map([
            ['a', NOW - 5000],
            ['b', NOW - 1000],
        ]);
        const result = pickRandomAlbum(albums, blocked, 'b', NOW, weighted_random);
        expect(result).toEqual({ album: albums[0], deck_reset: true });
        expect([...blocked]).toEqual([['b', NOW - 1000]]);
    });

    it('does not reset if unblocked albums are left', () => {
        const albums = [album('a'), album('b')];
        const blocked = new Map([['a', NOW - 1000]]);
        expect(pickRandomAlbum(albums, blocked, null, NOW, weighted_random).deck_reset).toBe(false);
    });

    it('shows the only album even if it is excluded', () => {
        const albums = [album('a')];
        expect(pickRandomAlbum(albums, new Map(), 'a', NOW, weighted_random).album?.id).toBe('a');
    });

    it('returns no album for an empty library', () => {
        expect(pickRandomAlbum([], new Map(), null, NOW, weighted_random)).toEqual({
            album: null,
            deck_reset: false,
        });
    });

    it('passes the recent/old weights to the roulette', () => {
        const albums = [album('old', 100), album('new', 1)];
        let received: { album: SavedAlbum; weight: number }[] = [];
        pickRandomAlbum(albums, new Map(), null, NOW, (objects) => {
            received = objects as any;
            return objects[0];
        });
        expect(received.map((candidate) => [candidate.album.id, candidate.weight])).toEqual([
            ['old', 2],
            ['new', 1],
        ]);
    });
});

describe('countBlocked', () => {
    it('only counts blocked albums that are still in the library', () => {
        const albums = [album('a'), album('b')];
        const blocked = new Map([
            ['a', NOW],
            ['removed_from_library', NOW],
        ]);
        expect(countBlocked(albums, blocked)).toBe(1);
    });
});
