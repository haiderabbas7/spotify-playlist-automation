import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { AuthService } from '../auth/auth.service';
import { HelperService } from '../helper/helper.service';
import { SpotifyApiService } from '../spotify-api/spotify-api.service';

@Injectable()
export class UserService {
    constructor(
        private readonly configService: ConfigService,
        private readonly httpService: HttpService,
        private readonly authService: AuthService,
        private readonly helperService: HelperService,
        private readonly spotifyApiService: SpotifyApiService,
    ) {}

    getUserID() {
        return this.configService.get<string>('MY_USER_ID');
    }

    //FUNKTIONIERT
    //TODO: "ALT: BESSEREN ENDPOINT FÜR CURRENTLY PLAYING NUTZEN?"
    async getCurrentlyPlayingPlaylist(): Promise<string | null> {
        try {
            const data: any = await this.spotifyApiService.sendGetCall(`me/player`);
            if (data.is_playing && data.context.type === 'playlist') {
                return this.helperService.extractIDfromSpotifyURI(data.context.uri);
            } else {
                return null;
            }
        } catch (error) {
            console.error(error);
            throw error;
        }
    }
}
