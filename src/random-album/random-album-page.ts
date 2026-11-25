/**
 * HTML of the /random-album page
 * the page itself is static, the script asks the server for albums (POST /random-album/next)
 * album data is only inserted with textContent and attributes, never as HTML
 */
export function getRandomAlbumPage(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Random Album Picker</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎲</text></svg>">
    <style>
        :root {
            --green: #1ed760;
            --glass: rgba(255, 255, 255, 0.08);
            --glass-border: rgba(255, 255, 255, 0.12);
            --text-dim: rgba(255, 255, 255, 0.65);
        }
        * { box-sizing: border-box; }
        body {
            background: #121212;
            color: white;
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            margin: 0;
            padding: 28px;
            height: 100vh;
            height: 100dvh;
            overflow-x: hidden;
        }
        /* blurred, darkened copy of the cover behind everything, takes the colors of the current album */
        #backdrop {
            position: fixed;
            inset: -80px;
            z-index: -1;
            background: #121212 center / cover no-repeat;
            filter: blur(70px) brightness(0.45) saturate(1.3);
            transition: background-image 0.6s ease;
        }
        /* wide screens: info on the left, player on the right, everything fits without scrolling */
        #content {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
            gap: 40px;
            height: 100%;
            max-width: 1200px;
            margin: 0 auto;
        }
        .info { display: flex; flex-direction: column; min-height: 0; }
        header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
        .brand { font-size: 1.05em; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }
        .brand .dice { display: inline-block; margin-right: 6px; }
        #subtitle { color: var(--text-dim); font-size: 0.9em; }
        #cover {
            width: min(100%, 40vh);
            width: min(100%, 40dvh);
            aspect-ratio: 1;
            object-fit: cover;
            border-radius: 14px;
            background: var(--glass);
            box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
        }
        h1 {
            font-size: clamp(1.5em, 3.2vw, 2.4em);
            line-height: 1.1;
            margin: 22px 0 6px;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
        #artists { font-size: 1.2em; color: var(--text-dim); margin: 0 0 14px; font-weight: 500; }
        .chips { display: flex; gap: 8px; flex-wrap: wrap; }
        .chip {
            background: var(--glass);
            border: 1px solid var(--glass-border);
            border-radius: 999px;
            padding: 4px 12px;
            font-size: 0.85em;
            color: var(--text-dim);
        }
        .links, .buttons { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; }
        .link {
            color: white;
            text-decoration: none;
            font-size: 0.9em;
            padding: 6px 14px;
            border-radius: 999px;
            border: 1px solid var(--glass-border);
            transition: background 0.15s, border-color 0.15s;
        }
        .link:hover { background: var(--glass); border-color: var(--green); }
        button {
            font: inherit;
            font-weight: 600;
            border: 1px solid var(--glass-border);
            border-radius: 999px;
            padding: 11px 22px;
            cursor: pointer;
            color: white;
            background: var(--glass);
            backdrop-filter: blur(10px);
            transition: transform 0.12s, background 0.15s, filter 0.15s;
        }
        button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.16); transform: translateY(-1px); }
        button:active:not(:disabled) { transform: scale(0.97); }
        button.primary { background: var(--green); color: black; border-color: transparent; font-size: 1.05em; }
        button.primary:hover:not(:disabled) { background: var(--green); filter: brightness(1.1); transform: scale(1.04); }
        button:disabled { opacity: 0.45; cursor: default; }
        #notice { color: #f5c518; margin: 14px 0 0; font-size: 0.9em; min-height: 1.2em; }
        #notice.error { color: #ff7b7b; }
        .progress { margin-top: auto; padding-top: 14px; }
        #counter { color: var(--text-dim); font-size: 0.8em; margin: 0 0 6px; }
        .bar { height: 4px; border-radius: 2px; background: var(--glass); overflow: hidden; }
        #bar_fill { height: 100%; width: 0; background: var(--green); transition: width 0.4s ease; }
        /* two players on top of each other: the hidden one loads the next album, then they swap */
        .player {
            position: relative;
            min-height: 0;
            border-radius: 14px;
            box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
        }
        .embed { position: absolute; inset: 0; width: 100%; height: 100%; border: none; border-radius: 14px; transition: opacity 0.25s; }
        .embed.standby { opacity: 0; visibility: hidden; }
        /* short fade when a new album appears */
        .fade-in { animation: fade-in 0.35s ease; }
        @keyframes fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        /* narrow screens (phone): stacked, smaller cover, the player takes the rest of the height */
        @media (max-width: 800px) {
            body { padding: 16px; }
            #content { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(152px, 1fr); gap: 16px; }
            header { margin-bottom: 10px; }
            #cover { width: min(100%, 24vh); width: min(100%, 24dvh); }
            h1 { font-size: 1.4em; margin-top: 12px; }
            #artists { font-size: 1em; margin-bottom: 8px; }
            .links, .buttons { margin-top: 12px; }
            button { padding: 9px 16px; }
            .progress { margin-top: 10px; padding-top: 0; }
        }
        #status { height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 18px; }
        #status .brand { margin-bottom: 8px; }
        #status_text { color: var(--text-dim); margin: 0; }
        #status.error #status_text { color: #ff7b7b; }
        .spinner {
            width: 44px;
            height: 44px;
            border: 4px solid var(--glass-border);
            border-top-color: var(--green);
            border-radius: 50%;
            animation: spin 0.9s linear infinite;
        }
        #status.error .spinner { display: none; }
        @keyframes spin { to { transform: rotate(360deg); } }
        [hidden] { display: none !important; }
    </style>
</head>
<body>
<div id="backdrop"></div>
<div id="status" hidden>
    <div class="brand"><span class="dice">🎲</span>Random Album Picker</div>
    <div class="spinner"></div>
    <p id="status_text"></p>
</div>
<main id="content" hidden>
    <div class="info">
        <header>
            <div class="brand"><span class="dice">🎲</span>Random Album Picker</div>
            <div id="subtitle"></div>
        </header>
        <div id="album">
            <img id="cover" alt="Album cover">
            <h1 id="name"></h1>
            <p id="artists"></p>
            <div class="chips">
                <span class="chip" id="year"></span>
                <span class="chip" id="tracks"></span>
                <span class="chip" id="added"></span>
            </div>
            <div class="links">
                <a class="link" id="app_link">▶ Open in Spotify</a>
                <a class="link" id="web_link" target="_blank" rel="noopener">↗ Web player</a>
            </div>
        </div>
        <div class="buttons">
            <button id="next_button" class="primary">🎲 Another one</button>
            <button id="back_button">← Back</button>
            <button id="reload_button">↻ Refresh library</button>
        </div>
        <p id="notice"></p>
        <div class="progress">
            <p id="counter"></p>
            <div class="bar"><div id="bar_fill"></div></div>
        </div>
    </div>
    <div class="player">
        <iframe class="embed" title="Spotify player" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>
        <iframe class="embed standby" title="Spotify player" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>
    </div>
</main>
<script>
    //albums shown in this tab, the last one is on screen
    const shown_albums = [];
    let total = 0;
    //"Another one" only shows the spinner if the server takes longer than this, i.e. when the library is reloaded
    const SPINNER_DELAY_MS = 1000;
    //a slow Spotify player does not hold back the album longer than this
    const EMBED_TIMEOUT_MS = 4000;
    const embeds = document.querySelectorAll('.embed');
    let active_embed = 0;

    const element = (id) => document.getElementById(id);

    function showStatus(text, is_error) {
        element('status_text').textContent = text;
        element('status').classList.toggle('error', is_error);
        element('status').hidden = false;
        element('content').hidden = true;
    }

    function showNotice(text, is_error) {
        element('notice').textContent = text;
        element('notice').classList.toggle('error', is_error);
    }

    /**
     * POST to the server, returns the JSON or null on an error (the error is shown on the page)
     * spinner_delay: after how many ms the spinner replaces the page, 0 = right away
     */
    async function request(url, spinner_delay) {
        const spinner_timer = setTimeout(() => showStatus('Loading your albums...', false), spinner_delay);
        try {
            const response = await fetch(url, { method: 'POST' });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'Request failed (' + response.status + ')');
            }
            return data;
        } catch (error) {
            if (shown_albums.length === 0) {
                showStatus(error.message, true);
            } else {
                //keep showing the current album, with the error below the buttons
                element('status').hidden = true;
                element('content').hidden = false;
                showNotice(error.message, true);
            }
            return null;
        } finally {
            //on success the spinner stays until render, so there is no empty page while the cover loads
            clearTimeout(spinner_timer);
        }
    }

    /**
     * Loads cover and player of an album in the background, so everything changes at the same moment
     */
    function preload(album) {
        return Promise.all([preloadCover(album), preloadEmbed(album)]);
    }

    //a broken cover does not block the album
    async function preloadCover(album) {
        if (!album.cover_url) return;
        const image = new Image();
        image.src = album.cover_url;
        await image.decode().catch(() => {});
    }

    //loads the album into the hidden player, swapEmbed shows it
    function preloadEmbed(album) {
        const standby = embeds[1 - active_embed];
        return new Promise((resolve) => {
            const timer = setTimeout(resolve, EMBED_TIMEOUT_MS);
            standby.onload = () => {
                clearTimeout(timer);
                resolve();
            };
            standby.src = 'https://open.spotify.com/embed/album/' + album.id;
        });
    }

    function swapEmbed() {
        const previous = embeds[active_embed];
        active_embed = 1 - active_embed;
        embeds[active_embed].classList.remove('standby');
        previous.classList.add('standby');
        //empties the old player, otherwise music playing there would keep going while hidden
        previous.onload = null;
        previous.src = 'about:blank';
    }

    //runs one action at a time and disables the buttons meanwhile
    async function busy(action) {
        setButtonsDisabled(true);
        try {
            await action();
        } finally {
            setButtonsDisabled(false);
        }
    }

    async function showNext(reload) {
        const current = shown_albums[shown_albums.length - 1];
        const params = new URLSearchParams();
        if (current) params.set('exclude', current.id);
        if (reload) params.set('reload', '1');
        //first load and refresh always load the library, so the spinner shows right away
        const spinner_delay = shown_albums.length === 0 || reload ? 0 : SPINNER_DELAY_MS;
        const data = await request('/random-album/next?' + params, spinner_delay);
        if (data === null) return;
        if (data.album === null) {
            //with an album on screen the buttons stay usable, otherwise there is nothing to show
            if (shown_albums.length === 0) {
                showStatus('No saved albums found.', true);
            } else {
                showNotice('No saved albums found.', true);
            }
            return;
        }
        await preload(data.album);
        shown_albums.push(data.album);
        total = data.total;
        const notices = [];
        if (data.deck_reset) notices.push('All albums seen, starting over');
        if (data.warning) notices.push(data.warning);
        render(data.album, data.seen_count);
        showNotice(notices.join(' · '), false);
    }

    async function showBack() {
        if (shown_albums.length < 2) return;
        const album = shown_albums[shown_albums.length - 2];
        //going back means you want this album after all, so it is released again
        const data = await request('/random-album/unblock/' + encodeURIComponent(album.id), SPINNER_DELAY_MS);
        //without the release on the server the page and the server would disagree, so stay on the album
        if (data === null) return;
        await preload(album);
        shown_albums.pop();
        render(album, data.seen_count);
        showNotice('', false);
    }

    function render(album, seen_count) {
        element('cover').src = album.cover_url || '';
        element('backdrop').style.backgroundImage = album.cover_url
            ? 'url("' + album.cover_url.replace(/"/g, '%22') + '")'
            : 'none';
        element('name').textContent = album.name;
        element('name').title = album.name;
        element('artists').textContent = album.artists;
        element('year').textContent = album.release_year;
        element('tracks').textContent = album.total_tracks + (album.total_tracks === 1 ? ' track' : ' tracks');
        element('added').textContent = 'Saved ' + new Date(album.added_at).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short', year: 'numeric',
        });
        element('app_link').href = 'spotify:album:' + album.id;
        element('web_link').href = 'https://open.spotify.com/album/' + album.id;
        element('subtitle').textContent = 'from your ' + total + ' saved albums';
        swapEmbed();
        element('counter').textContent = seen_count + ' of ' + total + ' seen in the last 8 hours';
        element('bar_fill').style.width = (total > 0 ? (seen_count / total) * 100 : 0) + '%';
        //restarts the fade animation for the new album
        element('album').classList.remove('fade-in');
        void element('album').offsetWidth;
        element('album').classList.add('fade-in');
        element('status').hidden = true;
        element('content').hidden = false;
    }

    function setButtonsDisabled(disabled) {
        element('next_button').disabled = disabled;
        element('reload_button').disabled = disabled;
        element('back_button').disabled = disabled || shown_albums.length < 2;
    }

    element('next_button').addEventListener('click', () => busy(() => showNext(false)));
    element('back_button').addEventListener('click', () => busy(showBack));
    element('reload_button').addEventListener('click', () => busy(() => showNext(true)));
    busy(() => showNext(false));
</script>
</body>
</html>`;
}
