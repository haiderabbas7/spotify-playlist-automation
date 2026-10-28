# Spotify Playlist Automation

A small background app for people who sort their music into playlists by hand.

## The problem

I collect new music in "queue" playlists: new artists to check out, albums to listen through, deep dives into one artist. When a song in a queue is good, it should go into the main playlist of that genre. On the phone that means three steps per song: like it, find the right main playlist in the folder structure and add it, then remove it from the queue. The Spotify app makes this tedious enough that I barely listened to my queues on the go.

On top of that, Spotify's own shuffle kept playing the same songs of my big playlists over and over.

This app fixes both:

- **Queue routine:** you add a song you like to one fixed playlist (one tap in "Save to"). Once a day the app likes it, adds it to the main playlist of the queue it came from and removes it from the queue.
- **Shuffler:** shuffles the playlists you listened to recently, so songs that were at the top last time are less likely to come up again.

Both parts can be switched on and off independently.

## What it does

### Queue routine

You tell the app which playlist is a queue by putting a tag with its main playlist into the queue's description, e.g. `[T=Rock]`. Queues with the same main belong to the same project.

When you like a song while listening to a queue, add it to your **collect playlist**. If you also uncheck the queue in the same "Save to" dialog, the app knows exactly which queue it came from. Once a day the app then:

1. adds the song to your Liked Songs (songs that are already liked keep their position),
2. appends it to the main playlist of its queue (never twice),
3. removes it from the queue,
4. removes it from the collect playlist.

If the main playlist is unclear (the song is in queues of different projects, or in no queue at all), it goes into a **fallback playlist** you sort by hand. Nothing is ever removed from your Liked Songs, and a song is never removed from a queue before it is safely in the main playlist.

### Shuffler

Every hour the app looks at what you played. For each of your own playlists you listened to, it reorders the first 45 songs with a weighted random pick. Songs that were at the top last time lose weight, all others slowly gain weight. The playlist you are currently listening to is left alone.

## Is this for you?

You need:

- **Spotify Premium.** Spotify requires it for the account that owns a developer app.
- **Your own app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).** Spotify limits apps in development mode to a few manually added users, so everybody needs their own app. It takes about five minutes, see below.
- **A computer that runs regularly.** The routine runs when the app starts and then at most once every 20 hours. Your phone works as usual, the songs wait in the collect playlist until the computer is on.
- **Node.js** (20 or newer).

## Setup

1. **Create a Spotify app**
   - Open the [Developer Dashboard](https://developer.spotify.com/dashboard) and click "Create app".
   - Redirect URI: `http://127.0.0.1:777/start` (use a different port here and in `.env` if 777 is taken).
   - API: Web API.
   - Copy the Client ID and Client Secret from the app's settings.
2. **Install**
   ```
   git clone https://github.com/haiderabbas7/spotify-playlist-automation.git
   cd spotify-playlist-automation
   npm install
   npm run build
   ```
3. **Configure:** copy `.env.example` to `.env` and fill in `CLIENT_ID` and `CLIENT_SECRET`. For the queue routine, also create two playlists in Spotify (a collect playlist and a fallback playlist) and enter their IDs (see [Get a playlist ID](#usage)).
4. **Start**
   - Try it in the foreground: `npm run start:prod`
   - Or in the background with PM2 (`npm install -g pm2`): on Windows run `scripts/start_application.bat`, elsewhere `pm2 start dist/src/main.js --name spotify-playlist-automation`.
5. **Log in:** on the first start a browser tab opens. Log in to Spotify and accept. The login is saved, later starts do not open the browser anymore.
6. **Start automatically (optional)**
   - Windows: create a task in Task Scheduler that runs `scripts/start_application.bat` when you log on.
   - macOS/Linux: `pm2 startup` and `pm2 save`.

## Usage

**Get a playlist ID:** in Spotify Desktop, hold **ALT**, right-click the playlist and choose **Share → Copy Spotify URI**. You get something like `spotify:playlist:0BfYlDPlZlFpDlJxxGNGWi`, the part after the last colon is the ID. Without ALT the menu only offers a link. In `.env` and in tags both the full URI and the plain ID work.

**Mark your queues:** write a tag anywhere into the description of each queue. The rest of the description is left untouched. Removing the tag turns the queue back into a normal playlist.

| Tag | Points to |
|---|---|
| `[T=Rock]` | Your playlist named exactly "Rock" (case and inner spaces count, spaces around are ignored) |
| `[T=0BfYlDPlZlFpDlJxxGNGWi]` | The playlist with this ID |
| `[T=spotify:playlist:0BfYlDPlZlFpDlJxxGNGWi]` | The same, as a URI |

A name is quicker to type, especially on the phone. An ID keeps working when you rename the main playlist.

**Broken tags:** if a tag points nowhere (unknown name or ID, two playlists with that name, more than one tag), the app writes the error right behind the tag in the description, e.g. `[T=Rokc] [⚠ ERROR: no playlist named "Rokc"]`. Songs from that queue stay untouched in the collect playlist until you fix the tag. The marker disappears on the next run after the fix, and the song is then processed as usual.

**Switches** in `settings.json` (created on the first start, changes apply without a restart):

| Key | Meaning |
|---|---|
| `shuffle_enabled` | Shuffler on or off |
| `routine_enabled` | Queue routine on or off |
| `routine_dry_run` | `true`: the routine only writes to the log what it would do. Good for trying it out |

**Log:** with PM2 everything is written to `logs/pm2.log`, for example:

```
(25.10. 09:22) [Routine] 1 songs in BEHALTEN
(25.10. 09:22) [Routine] "like wind" – chouchou merged syrups.: DISCOVERY - J-Rock → j rock, removed from queue
(25.10. 09:22) [Routine] Done: processed 1, failed 0, skipped 0 (107 API calls)
```

**Run something right now** while the app is running: open `http://127.0.0.1:777/routine` or `http://127.0.0.1:777/shuffle`.

## Limitations

- **Local files** cannot be moved through the Spotify API. They stay in the collect playlist and have to be sorted by hand.
- **Spotify folders** are invisible to the API. That is why queues are linked to their main playlist with a tag instead of a folder.
- **The shuffler** only sees songs that were played to the end, and only the last 50 of them.
- One installation works for one Spotify account.

## How it works

The technical details (startup, login, retry logic, the shuffle algorithm, the routine's decision rules) are in [docs/how-it-works.md](docs/how-it-works.md).

## Built with

NestJS and TypeScript, the Spotify Web API (Authorization Code Flow), lowdb for local storage, PM2 for running in the background, Jest for tests.

## Development

```
npm test                            # unit tests
npx tsc --noEmit -p tsconfig.json   # type check
npm run lint                        # eslint + prettier
npm run build                       # build to dist/src/main.js
```

- Log: `logs/pm2.log` (`scripts/reset_logs.bat` empties it on Windows).
- Manual triggers while running: `GET /shuffle`, `GET /routine`.
- After code changes: `npm run build`, then `pm2 restart spotify-playlist-automation`.

## License

[MIT](LICENSE)
