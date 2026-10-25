import { Controller, Get, Redirect, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth/auth.service';
import { MainService } from './main/main.service';

@Controller()
export class AppController {
    constructor(
        private readonly authService: AuthService,
        private readonly mainService: MainService,
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
