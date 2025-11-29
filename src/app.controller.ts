import { Controller, Get, Redirect, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth/auth.service';
import { ConfigService } from '@nestjs/config';
import * as querystring from 'node:querystring';
import { MainService } from './main/main.service';

@Controller()
export class AppController {
    private readonly scope: any;
    private readonly client_id: any;
    private readonly redirect_uri: any;
    constructor(
        private readonly authService: AuthService,
        private readonly configService: ConfigService,
        private readonly mainService: MainService,
    ) {
        this.scope =
            'user-read-playback-state user-read-recently-played playlist-modify-public playlist-modify-private';
        this.client_id = this.configService.get<string>('CLIENT_ID');
        this.redirect_uri = 'http://127.0.0.1:' + this.configService.get<string>('PORT') + '/';
    }

    @Get()
    @Redirect()
    login() {
        return {
            url:
                'https://accounts.spotify.com/authorize?' +
                querystring.stringify({
                    response_type: 'code',
                    client_id: this.client_id,
                    scope: this.scope,
                    redirect_uri: this.redirect_uri + 'start',
                }),
        };
    }

    @Get('/start')
    async startApplication(@Req() req: Request) {
        await this.authService.requestTokens({
            redirect_uri: this.redirect_uri + 'start',
            code: req.query.code,
        });

        //zum testen
        //this.mainService.testMain();

        //wichtig: hier darf kein await dranstehen, damit das HTML direkt angeschickt werden kann
        this.mainService.startShuffleApplication(true);

        /*WICHTIG: google nochmal ordentlich, ob sich eine möglichkeit finden lässt, mit dem ich den tab hier schließen kann
         *  weil ich gib mich nicht geschlagen damit, dass man den Tab selber schließen muss*/

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
                <p>Close the tab vro...👅👅👅👅👅</p>
            </body>
            </html>
        `;
    }

    @Get('/shuffle')
    async shuffle(@Req() req: Request) {
        this.mainService.startShuffleApplication();
    }

    /*OPTIONAL: mach hier eine route config, womit ich vllt paar sachen konfigurieren kann. wird halt iwie persistiert*/
}
