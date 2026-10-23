import { Injectable } from '@nestjs/common';
import { SpotifyApiService } from '../spotify-api/spotify-api.service';

@Injectable()
export class TrackService {
    constructor(private readonly spotifyApiService: SpotifyApiService) {}

    /**
     * Alle Songs einer Playlist, aber nur URI und is_local
     */
    async getTracksOfPlaylistByIDOnlyNecessaryInfo(playlist_id: string) {
        return await this.getTracksOfPlaylistByID(playlist_id, 'next,items(is_local,item(uri))');
    }

    /**
     * WICHTIG: wenn fields angegeben wird, muss next mit drin sein, sonst gibt es nur die ersten 100 Songs
     */
    async getTracksOfPlaylistByID(playlist_id: string, fields: string = ''): Promise<any[]> {
        return await this.spotifyApiService.getAllPages(`playlists/${playlist_id}/items`, {
            ...(fields && { fields }),
        });
    }

    /**
     * Angepasste methode für den kaputten unzuverlässigen endpoint
     * basically man gibt ein end_date an und die methode liefert alle Tracks, die zwischen JETZT und diesem end date gehört wurden
     * gibt man kein enddate, so werden einfach die songs returned, die in den letzten zwei stunden gehört wurden
     * ACHTUNG: Spotify liefert maximal die letzten 50 Songs, weiter zurück geht es nicht
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
