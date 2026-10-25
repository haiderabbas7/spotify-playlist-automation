import { Injectable } from '@nestjs/common';
import { SpotifyApiService } from '../spotify-api/spotify-api.service';

@Injectable()
export class TrackService {
    constructor(private readonly spotifyApiService: SpotifyApiService) {}

    /**
     * All songs of a playlist, but only URI and is_local
     */
    async getTracksOfPlaylistByIDOnlyNecessaryInfo(playlist_id: string) {
        return await this.getTracksOfPlaylistByID(playlist_id, 'next,items(is_local,item(uri))');
    }

    /**
     * IMPORTANT: if fields is set, it has to include next, otherwise only the first 100 songs are returned
     */
    async getTracksOfPlaylistByID(playlist_id: string, fields: string = ''): Promise<any[]> {
        return await this.spotifyApiService.getAllPages(`playlists/${playlist_id}/items`, {
            ...(fields && { fields }),
        });
    }

    /**
     * Wrapper for the unreliable recently-played endpoint
     * returns all tracks played between NOW and end_date
     * without end_date, the songs of the last two hours are returned
     * NOTE: Spotify returns at most the last 50 songs, it does not go further back
     * */
    async getRecentlyPlayedTracks(end_date?: Date): Promise<any[]> {
        const past_date: Date = end_date ?? new Date(Date.now() - 2 * 60 * 60 * 1000);
        const received_tracks: any = await this.spotifyApiService.sendGetCall(
            'me/player/recently-played',
            { limit: 50 },
        );
        return received_tracks.items.filter((track: any) => new Date(track.played_at) >= past_date);
    }
}
