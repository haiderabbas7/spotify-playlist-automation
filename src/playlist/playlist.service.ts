import { Injectable } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { HelperService } from '../helper/helper.service';
import { TrackService } from '../track/track.service';
import { SpotifyApiService } from '../spotify-api/spotify-api.service';

@Injectable()
export class PlaylistService {
    private static readonly TIMESTAMP_PREFIX = ' (Playlist last shuffled on ';
    //findet den kompletten Zeitstempel inklusive Leerzeichen davor, egal wo er in der Beschreibung steht
    private static readonly TIMESTAMP_REGEX = /\s*\(Playlist last shuffled on [^)]*\)/g;

    constructor(
        private readonly userService: UserService,
        private readonly helperService: HelperService,
        private readonly trackService: TrackService,
        private readonly spotifyApiService: SpotifyApiService,
    ) {}

    /**
     * true, wenn die Playlist Haider gehört (owner = MY_USER_ID aus der .env)
     */
    isOwnPlaylist(playlist: any): boolean {
        return playlist.owner.id === this.userService.getUserID();
    }

    /**
     * IDs aller eigenen Playlists, aus denen in den letzten x Stunden ein Song zu Ende gehört wurde (über recently-played)
     */
    async getOwnListenedPlaylists(x_hours_back: number = 2): Promise<string[]> {
        const end_date = new Date(Date.now() - x_hours_back * 60 * 60 * 1000);
        const listened_tracks: any[] = await this.trackService.getRecentlyPlayedTracks(end_date);
        const playlist_ids: Set<string> = new Set<string>();

        //DIESER STEP IST WICHTIG! dadurch dass ich immer neu frage, welche playlists ich habe, werden keine gelöschten geshuffled
        const own_playlists = await this.getOwnPlaylists();

        // Abgleich mit den Playlists, die der Nutzer gehört hat
        for (const track of listened_tracks) {
            if (track.context?.type === 'playlist' && track.context.uri) {
                const playlist_id = this.helperService.extractIDfromSpotifyURI(track.context.uri);
                //er fügt die playlist_id nur ein, wenn es meine eigene playlist ist
                if (own_playlists.some((playlist) => playlist.id === playlist_id)) {
                    playlist_ids.add(playlist_id);
                }
            }
        }
        return [...playlist_ids];
    }

    /**
     * Alle Playlists, die Haider gehört (gefolgte Playlists anderer User fliegen raus)
     * die Einträge enthalten u.a. id, name, description, snapshot_id und items.total
     */
    async getOwnPlaylists(): Promise<any[]> {
        const playlists = await this.spotifyApiService.getAllPages('me/playlists', { limit: 50 });
        //in der Liste können null-Einträge stecken, z.B. bei gelöschten Playlists
        return playlists.filter((playlist) => playlist && this.isOwnPlaylist(playlist));
    }

    /**
     * Nur name, snapshot_id und Anzahl der Songs einer Playlist
     */
    async getPlaylistByIDOnlyNecessaryInfo(playlist_id: string) {
        return await this.getPlaylistByID(playlist_id, 'name,snapshot_id,items.total');
    }

    /**
     * Holt eine Playlist, mit fields kann man die Antwort auf bestimmte Felder begrenzen
     */
    async getPlaylistByID(playlist_id: string, fields: string = ''): Promise<any> {
        return await this.spotifyApiService.sendGetCall(`playlists/${playlist_id}`, {
            ...(fields && { fields }),
        });
    }

    /**
     * Verschiebt range_length Songs ab range_start vor die Position insert_before (Indizes 0-basiert)
     * gibt die neue snapshot_id zurück, die beim nächsten Reorder mitgeschickt wird
     */
    async reorderPlaylistByID(
        playlist_id: string,
        range_start: number,
        insert_before: number,
        snapshot_id: string = '',
        range_length: number = 1,
    ): Promise<string> {
        const response = await this.spotifyApiService.sendPutCall(
            `playlists/${playlist_id}/items`,
            {
                range_start,
                range_length,
                insert_before,
                //wenn snapshot_id gesetzt, dann wird es eingefügt
                ...(snapshot_id && { snapshot_id }),
            },
        );
        //returned nicht das Objekt mit einem string attribut, sondern den string selber
        return response.snapshot_id;
    }

    /**
     * Liefert die Beschreibung schon dekodiert, also mit " statt &quot;
     */
    async getPlaylistDescription(playlist_id: string): Promise<string> {
        const playlist: any = await this.getPlaylistByID(playlist_id, 'description');
        return this.helperService.decodeHTMLEntities(playlist.description ?? '');
    }

    /**
     * Überschreibt die Beschreibung einer Playlist komplett
     */
    async setPlaylistDescription(playlist_id: string, new_description: string) {
        await this.spotifyApiService.sendPutCall(`playlists/${playlist_id}`, {
            description: new_description,
        });
    }

    /**
     * Ersetzt NUR den alten Zeitstempel durch einen neuen, alles andere in der Beschreibung bleibt stehen
     * (früher wurde alles ab dem Zeitstempel abgeschnitten, auch Text der dahinter stand)
     */
    async addCurrentTimestampToPlaylistDescription(playlist_id: string) {
        const current_time = this.helperService.getCurrentTimestampFormatted();
        const current_description = await this.getPlaylistDescription(playlist_id);
        const description_without_timestamp = current_description
            .replace(PlaylistService.TIMESTAMP_REGEX, '')
            .trimEnd();
        const new_description = `${description_without_timestamp}${PlaylistService.TIMESTAMP_PREFIX}${current_time})`;
        await this.setPlaylistDescription(playlist_id, new_description);
    }
}
