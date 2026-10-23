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
    it('Song in genau einer Queue: in deren Main, aus der Queue löschen', () => {
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

    it('Haken bei der Queue entfernt: Herkunft ist diese Queue, andere Queues bleiben', () => {
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

    it('mehrere Queues im selben Projekt: in die Main, aus allen löschen', () => {
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

    it('Queues verschiedener Projekte: EINSORTIEREN, aus allen löschen', () => {
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

    it('in keiner Queue: EINSORTIEREN', () => {
        const [plan] = planRoutine(
            input({ collect_items: [song('s7')], queues: [queue('a1', MAIN_A, ['s1'])] }),
        );
        expect(plan.origin).toBe('no_queue');
        expect(plan.target_id).toBe(FALLBACK);
        expect(plan.remove_from_queue_ids).toEqual([]);
    });

    it('in keiner Queue, aber schon in einer Main: nur liken', () => {
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

    it('schon im Target: nicht nochmal einfügen, trotzdem aus der Queue löschen', () => {
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

    it('Main der Queue existiert nicht: EINSORTIEREN mit Warnung, trotzdem aus der Queue löschen', () => {
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

    it('Local File: bleibt in BEHALTEN, nichts passiert', () => {
        const [plan] = planRoutine(
            input({ collect_items: [song('spotify:local:a:b:c:100', true)] }),
        );
        expect(plan.origin).toBe('local_file');
        expect(plan.like).toBe(false);
        expect(plan.remove_from_collect).toBe(false);
        expect(plan.target_id).toBeNull();
    });

    it('Song doppelt in BEHALTEN: nur einmal verarbeiten', () => {
        const plans = planRoutine(
            input({
                collect_items: [song('s1'), song('s1')],
                queues: [queue('a1', MAIN_A, ['s1'])],
            }),
        );
        expect(plans).toHaveLength(1);
    });

    it('neue Queue ohne Cache: kein falsches "Haken entfernt"', () => {
        const [plan] = planRoutine(
            input({ collect_items: [song('s1')], queues: [queue('a1', MAIN_A, ['s1'], null)] }),
        );
        expect(plan.origin).toBe('single_queue');
    });
});

describe('parseTargetTags', () => {
    const ID = '0BfYlDPlZlFpDlJxxGNGWi';

    it('erkennt den Tag mit spotify:playlist:', () => {
        expect(
            parseTargetTags(
                `meine Notiz {spotify:playlist:${ID}} (Playlist last shuffled on 22.10. 16:00)`,
            ),
        ).toEqual([ID]);
    });

    it('erkennt den Tag nur mit ID', () => {
        expect(parseTargetTags(`{${ID}}`)).toEqual([ID]);
    });

    it('kein Tag: keine Queue', () => {
        expect(parseTargetTags('nur eine Beschreibung {kein tag}')).toEqual([]);
    });

    it('zwei verschiedene Tags: multiple', () => {
        expect(parseTargetTags(`{${ID}} {41yP6x49QBGMdkNN7ATj5Y}`)).toHaveLength(2);
    });
});
