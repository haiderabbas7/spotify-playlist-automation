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

    @Get()
    @Redirect()
    login() {
        return { url: this.authService.getLoginURL() };
    }

    @Get('/start')
    async startApplication(@Req() req: Request) {
        if (typeof req.query.code !== 'string') {
            return this.getHTMLPage(
                `Login failed: ${typeof req.query.error === 'string' ? req.query.error : 'unknown error'}`,
            );
        }
        await this.authService.requestTokens(req.query.code);

        //wichtig: hier darf kein await dranstehen, damit das HTML direkt angeschickt werden kann
        void this.mainService.startShuffleApplication(true);

        return this.getHTMLPage('Close the tab vro...👅👅👅👅👅');
    }

    @Get('/shuffle')
    shuffle() {
        void this.mainService.startShuffleApplication();
    }

    @Get('/routine')
    routine() {
        void this.mainService.startRoutineNow();
        return this.getHTMLPage('Routine started, check the log 👀');
    }

    private getHTMLPage(message: string): string {
        return `
            <html lang="en">
            <head>
                <title>My Spotify Shuffler</title>
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
