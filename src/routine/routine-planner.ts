/**
 * Decision logic of the queue routine, without any Spotify calls
 * so it can be tested with Jest (routine-planner.spec.ts)
 */

export type CollectItem = {
    uri: string;
    //for the log, e.g. "Song - Artist"
    label: string;
    is_local: boolean;
};

export type QueueState = {
    id: string;
    name: string;
    target_id: string;
    //content now
    uris: Set<string>;
    //content at the last run, null if the queue was never seen before
    previous_uris: Set<string> | null;
};

export type PlannerInput = {
    collect_items: CollectItem[];
    queues: QueueState[];
    //targets that exist and belong to the user
    valid_target_ids: Set<string>;
    //contents of the loaded mains and the fallback, a playlist missing here counts as empty
    playlist_contents: Map<string, Set<string>>;
    fallback_id: string;
};

export type SongOrigin =
    //the user removed it from the queue, gone from exactly these queues since the last run
    | 'removed_by_user'
    //in exactly one queue
    | 'single_queue'
    //in several queues with the same main
    | 'same_project'
    //in queues with different mains
    | 'different_projects'
    //in no queue
    | 'no_queue'
    //in no queue, but already in a main
    | 'already_in_main'
    //local file, the API cannot move it
    | 'local_file';

export type SongPlan = {
    uri: string;
    label: string;
    origin: SongOrigin;
    //queues the song came from (for the log)
    origin_queue_ids: string[];
    //null: do not add to any playlist (only like)
    target_id: string | null;
    //false if the song is already in the target (no duplicates)
    add_to_target: boolean;
    remove_from_queue_ids: string[];
    like: boolean;
    remove_from_collect: boolean;
    //e.g. when the target of a queue no longer exists
    warning: string | null;
};

export function planRoutine(input: PlannerInput): SongPlan[] {
    const plans: SongPlan[] = [];
    const seen_uris = new Set<string>();
    const target_ids = new Set(input.queues.map((queue) => queue.target_id));

    for (const item of input.collect_items) {
        //the same song several times in the collect playlist is processed once
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
        //the origin is certain, the song stays in other queues
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
            //only possible if the user removed it from queues of different projects
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
 * Reads the target tags from a queue description, e.g. {spotify:playlist:0BfYlDPlZlFpDlJxxGNGWi} or {0BfYlDPlZlFpDlJxxGNGWi}
 * empty array: no tag, so no queue. More than one ID: invalid, the queue is skipped
 */
export function parseTargetTags(description: string): string[] {
    const matches = description.matchAll(/\{\s*(?:spotify:playlist:)?([A-Za-z0-9]{22})\s*\}/g);
    return [...new Set([...matches].map((match) => match[1]))];
}
