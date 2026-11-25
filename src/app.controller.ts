import {
    Controller,
    Get,
    HttpCode,
    Param,
    Post,
    Query,
    Redirect,
    Req,
    ServiceUnavailableException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService, LoginRequiredError } from './auth/auth.service';
import { MainService } from './main/main.service';
import { RandomAlbumService } from './random-album/random-album.service';
import { HelperService } from './helper/helper.service';
import { getRandomAlbumPage } from './random-album/random-album-page';

@Controller()
export class AppController {
    constructor(
        private readonly authService: AuthService,
        private readonly mainService: MainService,
        private readonly randomAlbumService: RandomAlbumService,
        private readonly helperService: HelperService,
    ) {}

    /**
     * Route /: redirects to the Spotify login page
     */
    @Get()
    @Redirect()
    login() {
        return { url: this.authService.getLoginURL() };
    }

    /**
     * Route /start: callback after the Spotify login, saves the tokens and starts the first run (routine + shuffle)
     */
    @Get('/start')
    async startApplication(@Req() req: Request) {
        if (typeof req.query.code !== 'string') {
            return this.getHTMLPage(
                `Login failed: ${typeof req.query.error === 'string' ? req.query.error : 'unknown error'}`,
            );
        }
        await this.authService.requestTokens(req.query.code);

        //important: no await here, so the HTML is sent right away
        void this.mainService.startShuffleApplication(true);

        return this.getHTMLPage('Close the tab vro...👅👅👅👅👅');
    }

    /**
     * Route /shuffle: triggers a run manually (routine only if it is due, then shuffle)
     */
    @Get('/shuffle')
    shuffle() {
        void this.mainService.startShuffleApplication();
    }

    /**
     * Route /routine: triggers only the queue routine, right away
     */
    @Get('/routine')
    routine() {
        void this.mainService.startRoutineNow();
        return this.getHTMLPage('Routine started, check the log 👀');
    }

    /**
     * Route /random-album: page that shows a random album from the saved albums
     */
    @Get('/random-album')
    randomAlbumPage() {
        return getRandomAlbumPage();
    }

    /**
     * Picks the next random album for the page, as JSON
     * ?exclude=<album id>: never pick this album (the one on screen), ?reload=1: reload the library and clear all blocks
     */
    @Post('/random-album/next')
    @HttpCode(200)
    async nextRandomAlbum(@Query('exclude') exclude?: string, @Query('reload') reload?: string) {
        try {
            return await this.randomAlbumService.pickNext(exclude || null, reload === '1');
        } catch (error) {
            this.helperService.printWithTimestamp(
                `[RandomAlbum] Picking an album failed: ${String(error)}`,
                true,
            );
            throw new ServiceUnavailableException(
                error instanceof LoginRequiredError
                    ? 'Not logged in to Spotify, open / to log in'
                    : 'Could not load your albums from Spotify, check the log',
            );
        }
    }

    /**
     * Releases the 8 hour block of an album, used by the "Back" button
     */
    @Post('/random-album/unblock/:album_id')
    @HttpCode(200)
    unblockRandomAlbum(@Param('album_id') album_id: string) {
        return this.randomAlbumService.unblock(album_id);
    }

    /**
     * Small HTML page with a message, used as the response of the routes
     */
    private getHTMLPage(message: string): string {
        return `
            <html lang="en">
            <head>
                <title>Spotify Playlist Automation</title>
                <style>
                    body {
                        background-color: #333;
                        color: white;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        font-size: 2em;
                        font-family: Papyrus,serif;
                    }
                </style>
            </head>
            <body>
                <p>${message}</p>
            </body>
            </html>
        `;
    }
}
