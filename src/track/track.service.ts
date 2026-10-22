import { Injectable, forwardRef, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AuthService } from '../auth/auth.service';
import { PlaylistService } from '../playlist/playlist.service';
import { HelperService } from '../helper/helper.service';
import { SpotifyApiService } from '../spotify-api/spotify-api.service';

@Injectable()
export class TrackService {
    constructor(
        private readonly httpService: HttpService,
        private readonly authService: AuthService,
        //das löst die Circular Dependency mit PlaylistService auf, von Copilot und Nest docs
        @Inject(forwardRef(() => PlaylistService))
        private readonly playlistService: PlaylistService,
        private readonly helperService: HelperService,
        private readonly spotifyApiService: SpotifyApiService,
    ) {}

    async getTracksOfPlaylistByIDOnlyNecessaryInfo(playlist_id: string) {
        return await this.getTracksOfPlaylistByID(playlist_id, 'next,items(is_local,track(uri))');
    }

    async getTracksOfPlaylistByID(playlist_id: string, fields: string = ''): Promise<any> {
        try {
            let tracks: any[] = [];
            let nextURL: string = `playlists/${playlist_id}/tracks`;
            do {
                const data: any = await this.spotifyApiService.sendGetCall(
                    nextURL.replace('https://api.spotify.com/v1/', ''),
                    { ...(fields && { fields }) },
                );
                nextURL = data.next;
                tracks = tracks.concat(data.items);
            } while (nextURL !== null);
            return tracks;
        } catch (error) {
            console.error(error);
        }
    }

    async searchTrackNameByURI(uri: string): Promise<string> {
        //NORMAL: spotify:track:4L8rZacefAFsbYBI6iqQgz
        //LOCAL:  spotify:local:David+Wise:Donkey+Kong+Country%3A+Tropical+Freeze:Snomads+Island:127
        if (!uri.startsWith('spotify:')) {
            throw new Error(`Wrong URI format: ${uri}`);
        } else {
            const track_id = uri.substring(14);
            //FALL local song, er returned einfach die local song signature am ende der URI
            if (uri.startsWith('spotify:local')) return track_id;
            //FALL normaler song, er fragt einfach nach dem song mit der track_id und returned den namen
            else {
                const track = await this.spotifyApiService.sendGetCall(`tracks/${track_id}`);
                return track.name;
            }
        }
    }

    async getTrackByIndex(playlist_id: string, index: number): Promise<any> {
        try {
            const playlist_size = await this.playlistService.getPlaylistSizeByID(playlist_id);
            if (index === playlist_size) {
                throw new Error(`Index ${index} is out of bounds`);
            }
            return await this.spotifyApiService.sendGetCall(`playlists/${playlist_id}/tracks`, {
                limit: 1,
                offset: index,
            });
        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    /**
     * Angepasste methode für den kaputten unzuverlässigen endpoint
     * basically man gibt ein end_date an und die methode liefert alle Tracks, die zwischen JETZT und diesem end date gehört wurden
     * gibt man kein enddate, so werden einfach die songs returned, die in den letzten zwei stunden gehört wurden
     * */
    async getRecentlyPlayedTracks(end_date?: Date): Promise<any> {
        try {
            const unix_timestamp_now = (await this.helperService.getUnixTimestamp()).now();

            const current_date: Date = new Date();
            const past_date: Date =
                end_date ?? new Date(current_date.getTime() - 2 * 60 * 60 * 1000);

            const final_tracks: any[] = [];
            const received_tracks: any = await this.spotifyApiService.sendGetCall(
                `me/player/recently-played?limit=50&after=${unix_timestamp_now}`,
            );

            for (const track of received_tracks.items) {
                const track_played_at = new Date(track.played_at);
                if (track_played_at >= past_date) {
                    final_tracks.push(track);
                }
            }
            return final_tracks;
        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    //TODO: "ALT: METHODE ISLOCALSONG SCHREIBEN"
}
