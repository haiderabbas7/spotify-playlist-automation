# CLAUDE.md

Repository: `spotify-playlist-automation` (the local folder can stay `spotify-shuffler`; if it is renamed, point the Windows scheduled task to the new `scripts/start_application.bat`).

NestJS app that runs in the background on the owner's Windows PC (PM2) and talks to the Spotify Web API. Two independent modules: the **shuffler** (weighted shuffle of recently played playlists) and the **queue routine** (moves songs from the collect playlist BEHALTEN into Liked Songs and the main playlist of their queue).

## Before every commit (mandatory)

Run all three and only commit if they pass. The owner does not run them himself, so this is the only safety net:

```
npm test                      # Jest unit tests (src/**/*.spec.ts)
npx tsc --noEmit -p tsconfig.json
npm run lint
```

When you change the routine's decision rules (`src/routine/routine-planner.ts`), add or adjust a test in `routine-planner.spec.ts` for the changed behavior.

## Build and run

- `npm run build` writes to `dist/src/main.js`. PM2 runs exactly that file (`scripts/start_application.bat`, started by a Windows scheduled task on boot), so rebuild after code changes and `pm2 restart spotify-playlist-automation`.
- Log: `logs/pm2.log`. Manual triggers while running: `http://127.0.0.1:777/shuffle`, `http://127.0.0.1:777/routine`.

## Local files (gitignored, never commit)

- `.env`: PORT, CLIENT_ID, CLIENT_SECRET, COLLECT_PLAYLIST_ID, FALLBACK_PLAYLIST_ID (template: `.env.example`). The user ID is requested from Spotify via `GET /me`
- `tokens.json`: saved Spotify login (delete it to force a new browser login)
- `settings.json`: on/off switches (`shuffle_enabled`, `routine_enabled`, `routine_dry_run`), read on every run
- `lowdb.json`: shuffler weights. `routine.json`: routine's memory of queue contents

## Conventions

- Commit messages: Conventional Commits (`feat(routine): ...`, `fix(auth): ...`, `chore(deps): ...`).
- Ask the owner before every commit, merge and push. Default branch is `main`.
- Spotify write calls only with the owner's okay. Test playlists (TEST BEHALTEN, TEST QUEUE A1/A2/B, TEST MAIN A/B, TEST EINSORTIEREN, test_playlist_copy) may be used for tests.
- Code style: snake_case variables, English comments without personal names, logging via `HelperService.printWithTimestamp`, log messages in English. No personal paths or IDs in tracked files. Playlists are identified by ID, never by name. Queues are playlists whose description contains a `[T=<name|id|spotify:playlist:id>]` tag (exact name match). The owner's existing queues use `[T=<id>]`.
- `NEW-NOTES/` holds the owner's private notes: never rewrite or restructure the `.txt` files there. `NEW-NOTES/SO_FUNKTIONIERT_ES.md` is the plain-language guide for the owner and must be updated when behavior changes.
