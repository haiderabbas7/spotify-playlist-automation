import { Injectable } from '@nestjs/common';
import { PlaylistService } from '../playlist/playlist.service';
import { TrackService } from '../track/track.service';
import { UserService } from '../user/user.service';
import { HelperService } from '../helper/helper.service';
import { LowDbService } from '../low-db/low-db.service';
import * as lodash from 'lodash';

@Injectable()
export class ShuffleService {
    private readonly default_shuffle_amount: number = 45;
    constructor(
        private readonly playlistService: PlaylistService,
        private readonly trackService: TrackService,
        private readonly userService: UserService,
        private readonly helperService: HelperService,
        private readonly lowDBService: LowDbService,
    ) {}

    /**
     * Determines the playlists to shuffle:
     * all own playlists played in the last x hours, except the one currently playing
     */
    async determinePlaylistsToShuffle(x_hours_back: number = 2): Promise<string[]> {
        const shuffle_these_playlists: Set<string> = new Set<string>();

        //get the own playlists that were played
        const listened_playlists: string[] =
            await this.playlistService.getOwnListenedPlaylists(x_hours_back);
        for (const listened_playlist of listened_playlists) {
            shuffle_these_playlists.add(listened_playlist);
        }

        //remove the playlist that is currently playing
        //deleting does not fail if the playlist is not in the set
        const currently_playing_playlist: string | null =
            await this.userService.getCurrentlyPlayingPlaylist();
        if (currently_playing_playlist !== null) {
            shuffle_these_playlists.delete(currently_playing_playlist);
        }

        //convert the set back to an array
        return [...shuffle_these_playlists];
    }

    /**
     * Determines how many positions to shuffle from the playlist size and the requested amount
     * without a requested amount default_shuffle_amount is used, otherwise the requested amount
     * but never more than the playlist has songs
     */
    determineShuffleAmount(playlist_size: number, shuffle_amount: number = 0) {
        return shuffle_amount === 0
            ? Math.min(playlist_size, this.default_shuffle_amount)
            : Math.min(playlist_size, shuffle_amount);
    }

    /**
     * The actual shuffle: fills the first shuffle_amount positions of the playlist by weighted roulette
     * songs that were at the top in the last shuffle lose weight, all others gain a little
     * weights and last shuffled songs are stored per playlist in the lowdb
     */
    async dynamicWeightedShuffle(playlist_id: string, shuffle_amount: number = 0) {
        try {
            /*OPTIONAL: this requests total, name and snapshot id once and the tracks once
             *  both take almost 6 seconds together
             *  the tracks could also be requested together with the playlist
             *  check whether one call is faster*/
            const MIN_WEIGHT = 50;
            const BASE_WEIGHT = 500;
            //TODO: find better names for the two constants below
            const WEIGHT_LOWERING_RATE = 0.5;
            const WEIGHT_INCREASE_RATE = 1.1;
            const playlist =
                await this.playlistService.getPlaylistByIDOnlyNecessaryInfo(playlist_id);
            const playlist_size = playlist.items.total;
            const all_tracks =
                await this.trackService.getTracksOfPlaylistByIDOnlyNecessaryInfo(playlist_id);
            let new_snapshot_id = playlist.snapshot_id;
            let final_weighted_tracks: any[];

            shuffle_amount = this.determineShuffleAmount(playlist_size, shuffle_amount);

            //CASE playlist was shuffled before
            if (await this.lowDBService.doesPlaylistExist(playlist_id)) {
                let weighted_tracks = await this.lowDBService.getTracks(playlist_id);

                const snapshot_id_after_last_shuffle =
                    await this.lowDBService.getSnapshotID(playlist_id);

                //if the playlist was changed since the last shuffle, new_snapshot_id is different
                if (new_snapshot_id !== snapshot_id_after_last_shuffle) {
                    //reduce the track arrays to their uris, keeps the code simpler
                    const all_tracks_reduced_to_uris: string[] = all_tracks.map(
                        (track) => track.item.uri,
                    );
                    const weighted_tracks_reduced_to_uris: string[] = weighted_tracks.map(
                        (track) => track.uri,
                    );

                    //new tracks of the playlist via difference
                    const tracks_to_add = lodash.difference(
                        all_tracks_reduced_to_uris,
                        weighted_tracks_reduced_to_uris,
                    );

                    //removed tracks via difference in the other direction
                    const tracks_to_remove = lodash.difference(
                        weighted_tracks_reduced_to_uris,
                        all_tracks_reduced_to_uris,
                    );

                    //add the new tracks with base weight and remove the removed tracks
                    for (const track of tracks_to_add) {
                        await this.lowDBService.addTrack(playlist_id, track, BASE_WEIGHT);
                    }
                    for (const track of tracks_to_remove) {
                        await this.lowDBService.removeTrack(playlist_id, track);
                    }

                    /*OPTIONAL: this applies the changes and then reads all tracks from the lowdb again
                     *  the changes could also be applied to weighted_tracks directly
                     *  which would save the await call below*/
                    weighted_tracks = await this.lowDBService.getTracks(playlist_id);
                }
                //get the last shuffled tracks from the lowdb and reset them
                const last_shuffled_tracks =
                    await this.lowDBService.getLastShuffledTracks(playlist_id);
                await this.lowDBService.clearLastShuffledTracks(playlist_id);

                for (const track of weighted_tracks) {
                    //check for every track whether it was shuffled last time
                    const isInShuffledTracks = last_shuffled_tracks.some(
                        (shuffledTrack) => shuffledTrack.uri === track.uri,
                    );

                    //adjust the weight depending on whether the song was picked last time
                    if (isInShuffledTracks) {
                        const new_weight = Math.round(
                            Math.max(track.weight * WEIGHT_LOWERING_RATE, MIN_WEIGHT),
                        );
                        await this.lowDBService.updateWeight(playlist_id, track.uri, new_weight);
                    } else {
                        const new_weight = Math.round(track.weight * WEIGHT_INCREASE_RATE);
                        await this.lowDBService.updateWeight(playlist_id, track.uri, new_weight);
                    }
                }

                final_weighted_tracks = await this.lowDBService.getTracks(playlist_id);
            }
            //CASE playlist was never shuffled, so there is no entry in the lowdb
            else {
                await this.lowDBService.addPlaylist(playlist_id);
                for (const track of all_tracks) {
                    await this.lowDBService.addTrack(playlist_id, track.item.uri, BASE_WEIGHT);
                }
                /*OPTIONAL: the tracks do not have to be read from the lowdb again
                 *  they could be kept locally with base weight instead
                 *  which would save the await here*/
                final_weighted_tracks = await this.lowDBService.getTracks(playlist_id);
            }
            for (let i = 0; i < shuffle_amount; i++) {
                const chosen_track = this.helperService.getWeightedRandom(final_weighted_tracks);

                //remove the track from the roulette
                const index_in_weighted = final_weighted_tracks.findIndex(
                    (track) => track.uri === chosen_track.uri,
                );
                final_weighted_tracks.splice(index_in_weighted, 1);

                //find the track in all_tracks and reorder with it
                /*FIX: findIndex once returned -1 here
                 *  because the index could not be found, which caused a Spotify API error
                 *  on reorder, since range_start = -1 is invalid
                 *  it happened during tests but could not be reproduced afterwards
                 *  just so you know*/
                const track_index = all_tracks.findIndex(
                    (track) => track.item.uri === chosen_track.uri,
                );
                new_snapshot_id = await this.playlistService.reorderPlaylistByID(
                    playlist_id,
                    track_index,
                    i,
                    new_snapshot_id,
                );

                //move the picked track to the front of all_tracks too, so the indices stay consistent
                all_tracks.splice(i, 0, all_tracks.splice(track_index, 1)[0]);

                //remember the shuffled song in the lowdb for next time
                /*TODO: the shuffled tracks could be collected in a variable
                    and written to the lowdb in one go with a new method
                    so one await instead of N awaits for N tracks
                    not sure how much faster that would be*/
                await this.lowDBService.addShuffledTrack(
                    playlist_id,
                    chosen_track.uri,
                    chosen_track.weight,
                );
            }
            await this.lowDBService.setSnapshotID(playlist_id, new_snapshot_id);
        } catch (error) {
            this.helperService.printWithTimestamp(`Error occurred when shuffling`, true);
            throw error;
        }
    }

    /**
     * Plain random shuffle without weights, only used as a fallback if dynamicWeightedShuffle fails
     */
    async insertionShuffle(playlist_id: string, shuffle_amount: any = null): Promise<any> {
        const playlist = await this.playlistService.getPlaylistByIDOnlyNecessaryInfo(playlist_id);
        const playlist_size: number = playlist.items.total;
        let snapshot_id: string = playlist.snapshot_id;
        shuffle_amount = this.determineShuffleAmount(playlist_size, shuffle_amount);
        for (let i: number = 0; i < shuffle_amount; i++) {
            //random number from interval [i; playlist_size-1]
            const random_index = Math.floor(Math.random() * (playlist_size - i)) + i;
            snapshot_id = await this.playlistService.reorderPlaylistByID(
                playlist_id,
                random_index,
                i,
                snapshot_id,
            );
        }
    }
}
