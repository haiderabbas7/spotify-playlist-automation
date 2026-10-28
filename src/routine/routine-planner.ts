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
    //null if the tag of the queue could not be resolved, see target_error
    target_id: string | null;
    target_error: string | null;
    //content now
    uris: Set<string>;
    //content at the last run, null if the queue was never seen before
    previous_uris: Set<string> | null;
};

export type PlannerInput = {
    collect_items: CollectItem[];
    queues: QueueState[];
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
    | 'local_file'
    //one of its queues has a broken tag, the song is left alone until the tag is fixed
    | 'queue_error';

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
    //e.g. the error of a broken queue tag
    warning: string | null;
};

export function planRoutine(input: PlannerInput): SongPlan[] {
    const plans: SongPlan[] = [];
    const seen_uris = new Set<string>();
    const target_ids = new Set(
        input.queues.map((queue) => queue.target_id).filter((id): id is string => id !== null),
    );

    for (const item of input.collect_items) {
        //the same song several times in the collect playlist is processed once
        if (seen_uris.has(item.uri)) {
            continue;
        }
        seen_uris.add(item.uri);

        if (item.is_local || item.uri.startsWith('spotify:local:')) {
            plans.push(untouched(item, 'local_file', [], 'local file, please move it by hand'));
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

    //a broken tag in one of the involved queues: do nothing, so no song ends up in the wrong place
    const broken_queue = origin_queues.find((queue) => queue.target_id === null);
    if (broken_queue) {
        return untouched(
            item,
            'queue_error',
            origin_queues.map((queue) => queue.id),
            `queue "${broken_queue.name}": ${broken_queue.target_error}`,
        );
    }

    let target_id: string | null;
    if (origin === 'already_in_main') {
        target_id = null;
    } else if (origin === 'no_queue' || origin === 'different_projects') {
        target_id = input.fallback_id;
    } else {
        const origin_targets = [...new Set(origin_queues.map((queue) => queue.target_id))];
        //more than one target is only possible if the user removed it from queues of different projects
        target_id = origin_targets.length === 1 ? origin_targets[0] : input.fallback_id;
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
        warning: null,
    };
}

/**
 * Plan for a song that is left completely alone (stays in the collect playlist and in its queues)
 */
function untouched(
    item: CollectItem,
    origin: SongOrigin,
    origin_queue_ids: string[],
    warning: string,
): SongPlan {
    return {
        uri: item.uri,
        label: item.label,
        origin,
        origin_queue_ids,
        target_id: null,
        add_to_target: false,
        remove_from_queue_ids: [],
        like: false,
        remove_from_collect: false,
        warning,
    };
}

export type PlaylistRef = { id: string; name: string };

//null: no tag, so the playlist is no queue
export type TagResult = { target_id: string } | { error: string } | null;

//[T=Rock], [T=0BfYlDPlZlFpDlJxxGNGWi] or [T=spotify:playlist:0BfYlDPlZlFpDlJxxGNGWi]
const TAG_REGEX = /\[\s*[Tt]\s*=([^\]]*)\]/g;
//error marker the routine writes behind a broken tag, e.g. [⚠ ERROR: no playlist named "Rokc"]
const ERROR_MARKER_REGEX = /\s*\[⚠ ERROR:[^\]]*\]/g;
const URI_PREFIX = 'spotify:playlist:';

/**
 * Reads the [T=...] tag of a queue description and finds the main playlist it points to
 * the value can be a playlist ID, a spotify:playlist: URI or the exact name of one of the user's playlists
 * (spaces at the start and end are ignored, everything else has to match exactly)
 */
export function resolveQueueTag(
    description: string,
    queue_id: string,
    playlists: PlaylistRef[],
): TagResult {
    const values = [
        ...new Set([...removeErrorMarker(description).matchAll(TAG_REGEX)].map((m) => m[1].trim())),
    ];
    if (values.length === 0) {
        return null;
    }
    if (values.length > 1) {
        return { error: 'more than one [T=...] tag in the description' };
    }
    const value = values[0];
    if (value === '') {
        return { error: 'the tag is empty' };
    }

    let target_id: string;
    if (value.startsWith(URI_PREFIX)) {
        const id = value.substring(URI_PREFIX.length);
        if (!playlists.some((playlist) => playlist.id === id)) {
            return { error: `no own playlist with the ID "${id}"` };
        }
        target_id = id;
    } else if (playlists.some((playlist) => playlist.id === value)) {
        target_id = value;
    } else {
        const matches = playlists.filter((playlist) => playlist.name.trim() === value);
        if (matches.length === 0) {
            return { error: `no playlist named "${value}"` };
        }
        if (matches.length > 1) {
            return {
                error: `${matches.length} playlists are named "${value}", use the ID instead`,
            };
        }
        target_id = matches[0].id;
    }

    if (target_id === queue_id) {
        return { error: 'the tag points to the queue itself' };
    }
    return { target_id };
}

/**
 * The description without the error markers the routine wrote earlier
 */
export function removeErrorMarker(description: string): string {
    return description.replace(ERROR_MARKER_REGEX, '');
}

/**
 * The description with an error marker directly behind the tag, or without marker if error is null
 */
export function withErrorMarker(description: string, error: string | null): string {
    const clean = removeErrorMarker(description);
    if (error === null) {
        return clean;
    }
    //] would end the marker early
    const marker = ` [⚠ ERROR: ${error.replace(/]/g, ')')}]`;
    const tag = clean.match(new RegExp(TAG_REGEX.source));
    if (!tag || tag.index === undefined) {
        return clean + marker;
    }
    const tag_end = tag.index + tag[0].length;
    return clean.substring(0, tag_end) + marker + clean.substring(tag_end);
}
