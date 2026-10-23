import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HelperService } from '../helper/helper.service';
import { SpotifyApiService } from '../spotify-api/spotify-api.service';

@Injectable()
export class UserService {
    constructor(
        private readonly configService: ConfigService,
        private readonly helperService: HelperService,
        private readonly spotifyApiService: SpotifyApiService,
    ) {}

    /**
     * Haiders Spotify User-ID aus der .env
     */
    getUserID() {
        return this.configService.get<string>('MY_USER_ID');
    }

    /**
     * Gibt die ID der Playlist zurück, die gerade läuft, sonst null
     * null auch dann, wenn nichts läuft (Spotify antwortet dann mit 204 ohne Inhalt)
     * oder wenn der Song keinen Kontext hat, z.B. beim Radio oder einem einzelnen Song aus der Suche
     */
    async getCurrentlyPlayingPlaylist(): Promise<string | null> {
        const data: any = await this.spotifyApiService.sendGetCall('me/player/currently-playing');
        if (data?.is_playing && data.context?.type === 'playlist') {
            return this.helperService.extractIDfromSpotifyURI(data.context.uri);
        }
        return null;
    }
}
