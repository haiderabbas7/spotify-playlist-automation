# Spotify Scheduled Dynamic Playlist Shuffler

A NestJS app that runs in the background on a Windows PC and does two things with the Spotify Web API, each of which can be switched on and off on its own:

- **Shuffler:** shuffles the playlists you listened to recently. Tracks get weights, so songs that were at the top last time are less likely to be picked again.
- **Queue routine:** you put songs you like from a "queue" playlist into one collect playlist. Once a day the routine likes them, adds them to the main playlist of their queue and removes them from the queue.

## Packages & Technologies Used
- **Nest.js** – A progressive Node.js framework for building scalable server-side applications.
- **Spotify Web API** – An interface to interact with Spotify data, such as playlists, tracks, and user information.
- **OAuth2 Authorization Code Flow** – A secure authentication method that allows the app to access user data without exposing credentials.
- **NPM LowDB Flat File DB** – A lightweight, JSON-based database for storing data locally without requiring a full database server.
- **PM2 Package Manager 2** - A process manager for Node.js applications that enables automatic startup and background execution using a batch script and cron scheduling.
- **Jest** – Unit tests for the queue routine's decision rules.

## How the app runs

1. **Start:** A Windows scheduled task runs `start_application.bat` on boot, which starts `dist/src/main.js` with PM2. `main.ts` starts the Nest server on `PORT` and calls `MainService.startup()`.
2. **Login (`AuthService`):** The refresh token is saved in `tokens.json`. On startup the app refreshes it.
   - Valid login with all scopes → continue without a browser.
   - No login, rejected token or missing scopes → the browser opens `http://127.0.0.1:<PORT>/`, which redirects to Spotify. The callback `/start` saves the tokens and continues.
   - Spotify not reachable (e.g. network not up yet) → retry every minute for 30 minutes.
3. **Run (`MainService.startShuffleApplication`)**, once after login and then every hour (cron). Runs are queued, so the routine and the shuffle never run at the same time:
   1. **Queue routine**, always on startup, otherwise only if the last run is at least 20 hours ago.
   2. **Shuffle** of all own playlists played in the last 24 hours (startup) or 2 hours (hourly), except the one that is currently playing.
4. **Settings:** `settings.json` is read on every run, so changes apply without a restart.

### Shuffle algorithm (`ShuffleService.dynamicWeightedShuffle`)

- Played playlists are taken from `GET /me/player/recently-played`. That endpoint only returns the last 50 tracks that were played to the end.
- Every track of a playlist has a weight in `lowdb.json`. New tracks start at 500.
- Before each shuffle: tracks that were moved to the top last time are multiplied by 0.5 (minimum 50), all others by 1.1.
- The first 45 positions are then filled by weighted random picks (roulette), each moved with a reorder call. The picked tracks are stored for the next shuffle.
- If anything fails, `insertionShuffle` (plain random) is used as a fallback.
- Afterwards ` (Playlist last shuffled on DD.MM. HH:MM)` is written to the playlist description. Only that part is replaced, the rest of the description stays.

### Queue routine (`src/routine/`)

- **Queues** are own playlists whose description contains a tag with the ID of their main playlist: `{spotify:playlist:<main-id>}` or `{<main-id>}`. Queues pointing to the same main form a project. Spotify folders are not visible through the API.
- **Collect playlist** (`collect_playlist_id`, "BEHALTEN") holds the songs to process. **Fallback playlist** (`fallback_playlist_id`, "EINSORTIEREN") is used when the main is unclear.
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

- **Execution order** (`routine.service.ts`): like (only if not liked yet, re-liking moves a song to the top of Liked Songs) → append to the main (no duplicates) → remove from queues → remove from the collect playlist. If a step fails for a song, its remaining steps are skipped. The song stays in the collect playlist and is retried on the next run.
- **Memory:** `routine.json` stores the queue contents of the last run, which is how removed songs are detected. All queues are read in full on every run, because `snapshot_id` turned out to be unreliable as a change check.
- **Dry run:** with `routine_dry_run: true` the routine only logs what it would do.

## Setup

1. Create an app in the Spotify Developer Dashboard with the redirect URI `http://127.0.0.1:<PORT>/start`.
2. Create `.env`:
   ```
   PORT=777
   CLIENT_ID=...
   CLIENT_SECRET=...
   MY_USER_ID=...
   ```
3. `npm install`, `npm run build`, then start with `start_application.bat` (PM2) or `npm run start:prod`.
4. Log in once in the browser window that opens. `settings.json` is created with default values on the first run.

### settings.json

| Key | Meaning |
|---|---|
| `shuffle_enabled` | Shuffler on/off |
| `routine_enabled` | Queue routine on/off |
| `routine_dry_run` | Routine only logs what it would do |
| `collect_playlist_id` | Playlist the routine takes songs from |
| `fallback_playlist_id` | Playlist for songs without a clear main |

### Local files (gitignored)

`.env`, `tokens.json` (login), `settings.json`, `lowdb.json` (shuffle weights), `routine.json` (routine memory).

## Development

```
npm test                            # unit tests
npx tsc --noEmit -p tsconfig.json   # type check
npm run lint                        # eslint + prettier
npm run build                       # build to dist/src/main.js
```

- Log: `logs/pm2.log` (`reset_logs.bat` empties it).
- Manual triggers while running: `GET /shuffle`, `GET /routine`.
- After code changes: `npm run build`, then `pm2 restart spotify_shuffler`.
