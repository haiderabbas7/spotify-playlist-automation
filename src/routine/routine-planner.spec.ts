import {
    planRoutine,
    PlannerInput,
    QueueState,
    removeErrorMarker,
    resolveQueueTag,
    withErrorMarker,
} from './routine-planner';

const MAIN_A = 'mainAaaaaaaaaaaaaaaaaa';
const MAIN_B = 'mainBbbbbbbbbbbbbbbbbbb';
const FALLBACK = 'fallbackkkkkkkkkkkkkkk';

function queue(
    id: string,
    target_id: string | null,
    uris: string[],
    previous_uris: string[] | null = uris,
): QueueState {
    return {
        id,
        name: id,
        target_id,
        target_error: target_id === null ? 'no playlist named "Rokc"' : null,
        uris: new Set(uris),
        previous_uris: previous_uris === null ? null : new Set(previous_uris),
    };
}

function input(overrides: Partial<PlannerInput>): PlannerInput {
    return {
        collect_items: [],
        queues: [],
        playlist_contents: new Map(),
        fallback_id: FALLBACK,
        ...overrides,
    };
}

function song(uri: string, is_local: boolean = false) {
    return { uri, label: uri, is_local };
}

describe('planRoutine', () => {
    it('song in exactly one queue: into its main, removed from the queue', () => {
        const [plan] = planRoutine(
            input({ collect_items: [song('s1')], queues: [queue('a1', MAIN_A, ['s1', 's2'])] }),
        );
        expect(plan.origin).toBe('single_queue');
        expect(plan.target_id).toBe(MAIN_A);
        expect(plan.add_to_target).toBe(true);
        expect(plan.remove_from_queue_ids).toEqual(['a1']);
        expect(plan.like).toBe(true);
        expect(plan.remove_from_collect).toBe(true);
    });

    it('user removed it from a queue: that queue is the origin, other queues keep it', () => {
        const [plan] = planRoutine(
            input({
                collect_items: [song('s4')],
                queues: [queue('a2', MAIN_A, [], ['s4']), queue('b', MAIN_B, ['s4'])],
            }),
        );
        expect(plan.origin).toBe('removed_by_user');
        expect(plan.target_id).toBe(MAIN_A);
        expect(plan.remove_from_queue_ids).toEqual([]);
        expect(plan.origin_queue_ids).toEqual(['a2']);
    });

    it('several queues of the same project: into the main, removed from all of them', () => {
        const [plan] = planRoutine(
            input({
                collect_items: [song('s3')],
                queues: [queue('a1', MAIN_A, ['s3']), queue('a2', MAIN_A, ['s3'])],
            }),
        );
        expect(plan.origin).toBe('same_project');
        expect(plan.target_id).toBe(MAIN_A);
        expect(plan.remove_from_queue_ids).toEqual(['a1', 'a2']);
    });

    it('queues of different projects: fallback, removed from all of them', () => {
        const [plan] = planRoutine(
            input({
                collect_items: [song('s2')],
                queues: [queue('a1', MAIN_A, ['s2']), queue('b', MAIN_B, ['s2'])],
            }),
        );
        expect(plan.origin).toBe('different_projects');
        expect(plan.target_id).toBe(FALLBACK);
        expect(plan.remove_from_queue_ids).toEqual(['a1', 'b']);
    });

    it('in no queue: fallback', () => {
        const [plan] = planRoutine(
            input({ collect_items: [song('s7')], queues: [queue('a1', MAIN_A, ['s1'])] }),
        );
        expect(plan.origin).toBe('no_queue');
        expect(plan.target_id).toBe(FALLBACK);
        expect(plan.remove_from_queue_ids).toEqual([]);
    });

    it('in no queue but already in a main: only like', () => {
        const [plan] = planRoutine(
            input({
                collect_items: [song('s6')],
                queues: [queue('a1', MAIN_A, ['s1'])],
                playlist_contents: new Map([[MAIN_A, new Set(['s6'])]]),
            }),
        );
        expect(plan.origin).toBe('already_in_main');
        expect(plan.target_id).toBeNull();
        expect(plan.add_to_target).toBe(false);
        expect(plan.like).toBe(true);
        expect(plan.remove_from_collect).toBe(true);
    });

    it('already in the target: not added again, still removed from the queue', () => {
        const [plan] = planRoutine(
            input({
                collect_items: [song('s3')],
                queues: [queue('a1', MAIN_A, ['s3'])],
                playlist_contents: new Map([[MAIN_A, new Set(['s3'])]]),
            }),
        );
        expect(plan.add_to_target).toBe(false);
        expect(plan.remove_from_queue_ids).toEqual(['a1']);
    });

    it('broken tag: the song is left alone (stays in the collect playlist and the queue)', () => {
        const [plan] = planRoutine(
            input({ collect_items: [song('s1')], queues: [queue('a1', null, ['s1'])] }),
        );
        expect(plan.origin).toBe('queue_error');
        expect(plan.like).toBe(false);
        expect(plan.target_id).toBeNull();
        expect(plan.remove_from_queue_ids).toEqual([]);
        expect(plan.remove_from_collect).toBe(false);
        expect(plan.warning).toContain('Rokc');
    });

    it('broken tag and removed by the user: still left alone, not sent to the fallback', () => {
        const [plan] = planRoutine(
            input({ collect_items: [song('s1')], queues: [queue('a1', null, [], ['s1'])] }),
        );
        expect(plan.origin).toBe('queue_error');
        expect(plan.remove_from_collect).toBe(false);
    });

    it('local file: stays in the collect playlist, nothing happens', () => {
        const [plan] = planRoutine(
            input({ collect_items: [song('spotify:local:a:b:c:100', true)] }),
        );
        expect(plan.origin).toBe('local_file');
        expect(plan.like).toBe(false);
        expect(plan.remove_from_collect).toBe(false);
        expect(plan.target_id).toBeNull();
    });

    it('song twice in the collect playlist: processed once', () => {
        const plans = planRoutine(
            input({
                collect_items: [song('s1'), song('s1')],
                queues: [queue('a1', MAIN_A, ['s1'])],
            }),
        );
        expect(plans).toHaveLength(1);
    });

    it('new queue without cache: no false "removed by the user"', () => {
        const [plan] = planRoutine(
            input({ collect_items: [song('s1')], queues: [queue('a1', MAIN_A, ['s1'], null)] }),
        );
        expect(plan.origin).toBe('single_queue');
    });
});

describe('resolveQueueTag', () => {
    const ROCK = '0BfYlDPlZlFpDlJxxGNGWi';
    const playlists = [
        { id: ROCK, name: 'Rock' },
        { id: 'jazzjazzjazzjazzjazzjj', name: 'jazz  fusion' },
        { id: 'dup1dup1dup1dup1dup1du', name: 'Twice' },
        { id: 'dup2dup2dup2dup2dup2du', name: 'Twice' },
        { id: 'queuequeuequeuequeueqq', name: 'DISCOVERY - Rock' },
    ];
    const resolve = (description: string) =>
        resolveQueueTag(description, 'queuequeuequeuequeueqq', playlists);

    it('no tag: no queue', () => {
        expect(resolve('just a note {with braces} and [brackets]')).toBeNull();
    });

    it('by exact name, spaces around are ignored', () => {
        expect(resolve('my note [T= Rock ] (Playlist last shuffled on 22.10. 16:00)')).toEqual({
            target_id: ROCK,
        });
    });

    it('by ID and by URI', () => {
        expect(resolve(`[T=${ROCK}]`)).toEqual({ target_id: ROCK });
        expect(resolve(`[T=spotify:playlist:${ROCK}]`)).toEqual({ target_id: ROCK });
    });

    it('the name has to match exactly, also case and inner spaces', () => {
        expect(resolve('[T=rock]')).toEqual({ error: 'no playlist named "rock"' });
        expect(resolve('[T=jazz fusion]')).toHaveProperty('error');
        expect(resolve('[T=jazz  fusion]')).toEqual({ target_id: 'jazzjazzjazzjazzjazzjj' });
    });

    it('errors: duplicate name, unknown ID, two tags, empty tag, points to itself', () => {
        expect(resolve('[T=Twice]')).toHaveProperty('error');
        expect(resolve('[T=spotify:playlist:unknownunknownunknownu]')).toHaveProperty('error');
        expect(resolve(`[T=Rock] [T=${'jazzjazzjazzjazzjazzjj'}]`)).toHaveProperty('error');
        expect(resolve('[T=]')).toHaveProperty('error');
        expect(resolve('[T=DISCOVERY - Rock]')).toHaveProperty('error');
    });

    it('ignores an old error marker when reading the tag', () => {
        expect(resolve('[T=Rock] [⚠ ERROR: no playlist named "Rokc"]')).toEqual({
            target_id: ROCK,
        });
    });
});

describe('error marker', () => {
    it('is put directly behind the tag and removed again', () => {
        const with_marker = withErrorMarker('note [T=Rokc] (Playlist last shuffled on 1)', 'oops');
        expect(with_marker).toBe('note [T=Rokc] [⚠ ERROR: oops] (Playlist last shuffled on 1)');
        expect(removeErrorMarker(with_marker)).toBe('note [T=Rokc] (Playlist last shuffled on 1)');
        expect(withErrorMarker(with_marker, null)).toBe(
            'note [T=Rokc] (Playlist last shuffled on 1)',
        );
    });
});
