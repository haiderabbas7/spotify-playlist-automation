import { parseTargetTags, planRoutine, PlannerInput, QueueState } from './routine-planner';

const MAIN_A = 'mainAaaaaaaaaaaaaaaaaa';
const MAIN_B = 'mainBbbbbbbbbbbbbbbbbbb';
const FALLBACK = 'fallbackkkkkkkkkkkkkkk';

function queue(
    id: string,
    target_id: string,
    uris: string[],
    previous_uris: string[] | null = uris,
): QueueState {
    return {
        id,
        name: id,
        target_id,
        uris: new Set(uris),
        previous_uris: previous_uris === null ? null : new Set(previous_uris),
    };
}

function input(overrides: Partial<PlannerInput>): PlannerInput {
    return {
        collect_items: [],
        queues: [],
        valid_target_ids: new Set([MAIN_A, MAIN_B]),
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

    it('main of the queue does not exist: fallback with warning, still removed from the queue', () => {
        const [plan] = planRoutine(
            input({
                collect_items: [song('s1')],
                queues: [queue('a1', 'geloeschtxxxxxxxxxxxxx', ['s1'])],
            }),
        );
        expect(plan.target_id).toBe(FALLBACK);
        expect(plan.warning).not.toBeNull();
        expect(plan.remove_from_queue_ids).toEqual(['a1']);
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

describe('parseTargetTags', () => {
    const ID = '0BfYlDPlZlFpDlJxxGNGWi';

    it('detects the tag with spotify:playlist:', () => {
        expect(
            parseTargetTags(
                `my note {spotify:playlist:${ID}} (Playlist last shuffled on 22.10. 16:00)`,
            ),
        ).toEqual([ID]);
    });

    it('detects the tag with only the ID', () => {
        expect(parseTargetTags(`{${ID}}`)).toEqual([ID]);
    });

    it('no tag: no queue', () => {
        expect(parseTargetTags('just a description {no tag}')).toEqual([]);
    });

    it('two different tags: both are returned', () => {
        expect(parseTargetTags(`{${ID}} {41yP6x49QBGMdkNN7ATj5Y}`)).toHaveLength(2);
    });
});
