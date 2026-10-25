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
     * Spotify user ID of the logged in user
     */
    getUserID() {
        return this.configService.get<string>('MY_USER_ID');
    }

    /**
     * Returns the ID of the playlist that is currently playing, otherwise null
     * also null if nothing is playing (Spotify then answers with 204 and no content)
     * or if the song has no context, e.g. radio or a single song from the search
     */
    async getCurrentlyPlayingPlaylist(): Promise<string | null> {
        const data: any = await this.spotifyApiService.sendGetCall('me/player/currently-playing');
        if (data?.is_playing && data.context?.type === 'playlist') {
            return this.helperService.extractIDfromSpotifyURI(data.context.uri);
        }
        return null;
    }
}
