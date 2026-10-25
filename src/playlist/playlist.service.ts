import { Injectable } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { HelperService } from '../helper/helper.service';
import { TrackService } from '../track/track.service';
import { SpotifyApiService } from '../spotify-api/spotify-api.service';

@Injectable()
export class PlaylistService {
    private static readonly TIMESTAMP_PREFIX = ' (Playlist last shuffled on ';
    //matches the whole timestamp including the space before it, wherever it is in the description
    private static readonly TIMESTAMP_REGEX = /\s*\(Playlist last shuffled on [^)]*\)/g;

    constructor(
        private readonly userService: UserService,
        private readonly helperService: HelperService,
        private readonly trackService: TrackService,
        private readonly spotifyApiService: SpotifyApiService,
    ) {}

    /**
     * IDs of all own playlists from which a song was played to the end in the last x hours (via recently-played)
     */
    async getOwnListenedPlaylists(x_hours_back: number = 2): Promise<string[]> {
        const end_date = new Date(Date.now() - x_hours_back * 60 * 60 * 1000);
        const listened_tracks: any[] = await this.trackService.getRecentlyPlayedTracks(end_date);
        const playlist_ids: Set<string> = new Set<string>();

        //IMPORTANT: own playlists are requested every time, so deleted playlists are never shuffled
        const own_playlists = await this.getOwnPlaylists();

        // compare with the playlists the user listened to
        for (const track of listened_tracks) {
            if (track.context?.type === 'playlist' && track.context.uri) {
                const playlist_id = this.helperService.extractIDfromSpotifyURI(track.context.uri);
                //only add the playlist if it is an own playlist
                if (own_playlists.some((playlist) => playlist.id === playlist_id)) {
                    playlist_ids.add(playlist_id);
                }
            }
        }
        return [...playlist_ids];
    }

    /**
     * All playlists owned by the logged in user (followed playlists of other users are left out)
     * the entries contain id, name, description, snapshot_id and items.total among others
     */
    async getOwnPlaylists(): Promise<any[]> {
        const user_id = await this.userService.getUserID();
        const playlists = await this.spotifyApiService.getAllPages('me/playlists', { limit: 50 });
        //the list can contain null entries, e.g. for deleted playlists
        return playlists.filter((playlist) => playlist && playlist.owner.id === user_id);
    }

    /**
     * Only name, snapshot_id and number of songs of a playlist
     */
    async getPlaylistByIDOnlyNecessaryInfo(playlist_id: string) {
        return await this.getPlaylistByID(playlist_id, 'name,snapshot_id,items.total');
    }

    /**
     * Gets a playlist, fields limits the response to certain fields
     */
    async getPlaylistByID(playlist_id: string, fields: string = ''): Promise<any> {
        return await this.spotifyApiService.sendGetCall(`playlists/${playlist_id}`, {
            ...(fields && { fields }),
        });
    }

    /**
     * Moves range_length songs starting at range_start before the position insert_before (indices are 0-based)
     * returns the new snapshot_id, which is sent with the next reorder
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
                //snapshot_id is only sent if it is set
                ...(snapshot_id && { snapshot_id }),
            },
        );
        //returns the string itself, not the object with a string attribute
        return response.snapshot_id;
    }

    /**
     * Returns the description already decoded, so with " instead of &quot;
     */
    async getPlaylistDescription(playlist_id: string): Promise<string> {
        const playlist: any = await this.getPlaylistByID(playlist_id, 'description');
        return this.helperService.decodeHTMLEntities(playlist.description ?? '');
    }

    /**
     * Overwrites the whole description of a playlist
     */
    async setPlaylistDescription(playlist_id: string, new_description: string) {
        await this.spotifyApiService.sendPutCall(`playlists/${playlist_id}`, {
            description: new_description,
        });
    }

    /**
     * Replaces ONLY the old timestamp with a new one, everything else in the description stays
     * (previously everything from the timestamp on was cut off, including text after it)
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
