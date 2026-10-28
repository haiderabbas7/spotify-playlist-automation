# How it works

The technical side of Spotify Playlist Automation. For setup and usage see the [README](../README.md).

## Startup and schedule

1. **Start:** `scripts/start_application.bat` starts `dist/src/main.js` with PM2 (on Windows via a scheduled task on boot). `main.ts` starts the NestJS server on `PORT` and calls `MainService.startup()`.
2. **Login (`AuthService`):** the refresh token is stored in `tokens.json` and refreshed on startup.
   - Valid login with all scopes: continue without a browser.
   - No login, rejected token or missing scopes: the browser opens `http://127.0.0.1:<PORT>/`, which redirects to Spotify. The callback `/start` saves the tokens and continues.
   - Spotify not reachable (e.g. network not up yet after booting): retry every minute for 30 minutes.
3. **Runs (`MainService.startShuffleApplication`):** once after login and then every hour (cron). Runs are queued, so the routine and the shuffle never run at the same time.
   1. **Queue routine:** always on startup, otherwise only if the last run is at least 20 hours ago.
   2. **Shuffle:** all own playlists played in the last 24 hours (startup) or 2 hours (hourly), except the one currently playing.
4. **Settings:** `settings.json` is read on every run, so switches apply without a restart.

## Spotify API client (`SpotifyApiService`)

- One `request()` method for GET, POST, PUT and DELETE.
- Retries on 401 (token renewed), 429 (waits as long as `Retry-After` says), 5xx and network errors, with exponential backoff.
- `getAllPages()` follows the `next` links of paged responses.
- Failed calls end up as a one-line `SpotifyApiError` in the log.

## Shuffle algorithm (`ShuffleService.dynamicWeightedShuffle`)

- Played playlists come from `GET /me/player/recently-played`. That endpoint only returns the last 50 tracks that were played to the end.
- Every track of a playlist has a weight in `lowdb.json`. New tracks start at 500.
- Before each shuffle: tracks that were moved to the top last time are multiplied by 0.5 (minimum 50), all others by 1.1.
- The first 45 positions are then filled by weighted random picks (roulette), each moved with one reorder call. The picked tracks are stored for the next shuffle.
- **Why 45 single reorder calls instead of replacing the whole playlist in a few calls:** replacing the items would reset the "date added" of every song. Reordering keeps it.
- If anything fails, `insertionShuffle` (plain random) is used as a fallback.
- Afterwards ` (Playlist last shuffled on DD.MM. HH:MM)` is written to the playlist description. Only that part is replaced, the rest of the description stays. Descriptions come back HTML encoded from Spotify and are decoded before writing.

## Queue routine (`src/routine/`)

- **Queues** are own playlists whose description contains a `[T=...]` tag with their main playlist: an ID, a `spotify:playlist:` URI or the exact name of one of the user's own playlists (`resolveQueueTag` in `routine-planner.ts`). Queues pointing to the same main form a project. Spotify folders are not visible through the API, so the tag is the only link. Names are matched on every run against the list of own playlists, nothing is stored.
- **Broken tags** (unknown name or ID, duplicate name, several tags, tag pointing to the queue itself): songs whose origin includes such a queue are left untouched. In live mode `[⚠ ERROR: ...]` is written behind the tag and removed again once the tag resolves. The cache of a broken queue keeps the union of everything it contained, so a song the user removed while the tag was broken is still recognized after the fix.
- **Collect playlist** (`COLLECT_PLAYLIST_ID`) holds the songs to process. **Fallback playlist** (`FALLBACK_PLAYLIST_ID`) is used when the main is unclear.
- **Decision rules** live in `routine-planner.ts` as a pure function and are covered by `routine-planner.spec.ts`. For each song in the collect playlist:

| Situation | Result |
|---|---|
| Removed from queue Q since the last run (the user unchecked Q) | Main of Q, other queues keep the song |
| In exactly one queue | Main of that queue, removed from it |
| In several queues of the same project | That main, removed from all of them |
| In queues of different projects | Fallback, removed from all of them |
| In no queue | Fallback |
| In no queue, but already in a main | Only liked |
| Local file | Untouched, stays in the collect playlist (the API cannot move it) |
| One of its queues has a broken tag | Untouched until the tag is fixed |

- **Execution order** (`routine.service.ts`): like (only if not liked yet, because re-liking moves a song to the top of Liked Songs) → append to the main (no duplicates) → remove from queues → remove from the collect playlist. If a step fails for a song, its remaining steps are skipped. The song stays in the collect playlist and is retried on the next run.
- **Memory:** `routine.json` stores the queue contents of the last run, which is how removed songs are detected. All queues are read in full on every run, because `snapshot_id` turned out to be unreliable as a change check (Spotify sometimes returned the old one for minutes after a change).
- **Dry run:** with `routine_dry_run: true` the routine only logs what it would do.
- A run reads every queue, so it needs roughly 100 API calls with ~50 queues. Once a day this is far below any rate limit.

## Local files

| File | Content |
|---|---|
| `.env` | Credentials and playlist IDs (template: `.env.example`) |
| `tokens.json` | Saved Spotify login, delete it to force a new login |
| `settings.json` | On/off switches |
| `lowdb.json` | Shuffle weights |
| `routine.json` | Routine memory of queue contents |
| `logs/pm2.log` | Log |

All of them are gitignored.
