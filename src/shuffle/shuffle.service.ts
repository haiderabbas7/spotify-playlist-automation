import { Injectable } from '@nestjs/common';
import { PlaylistService } from '../playlist/playlist.service';
import { TrackService } from '../track/track.service';
import { UserService } from '../user/user.service';
import { HelperService } from '../helper/helper.service';
import { LowDbService } from '../low-db/low-db.service';
import * as lodash from 'lodash';
import { SpotifyApiService } from '../spotify-api/spotify-api.service';

@Injectable()
export class ShuffleService {
    private readonly default_shuffle_amount: number = 45;
    constructor(
        private readonly playlistService: PlaylistService,
        private readonly trackService: TrackService,
        private readonly userService: UserService,
        private readonly helperService: HelperService,
        private readonly lowDBService: LowDbService,
        private readonly spotifyApiService: SpotifyApiService,
    ) {}

    async determinePlaylistsToShuffle(x_hours_back: number = 2): Promise<string[]> {
        const shuffle_these_playlists: Set<string> = new Set<string>();

        //fragt die eigenen gehörten playlists ab
        const listened_playlists: string[] =
            await this.playlistService.getOwnListenedPlaylists(x_hours_back);
        for (const listened_playlist of listened_playlists) {
            shuffle_these_playlists.add(listened_playlist);
        }

        //fragt nach ob momentan eine playlist am laufen ist und deleted sie aus dem array
        //deleten kann nicht error erzeugen wenn playlist nicht drin ist
        const currently_playing_playlist: any =
            await this.userService.getCurrentlyPlayingPlaylist();
        if (currently_playing_playlist !== '') {
            shuffle_these_playlists.delete(currently_playing_playlist);
        }

        //wandelt das set wieder in ein array um
        return [...shuffle_these_playlists];
    }

    /**
     * bestimmt die shuffle amount anhand playlist größe und der gewünschten shuffle amount
     * wenn kein wunsch geäußert, dann macht er default_shuffle_amount. wenn wunsch, dann eben der wunsch
     * wenn aber zu wenige songs da sind dann shuffled er halt nur so viele wie da sind du weißt
     */
    determineShuffleAmount(playlist_size: number, shuffle_amount: number = 0) {
        return shuffle_amount === 0
            ? Math.min(playlist_size, this.default_shuffle_amount)
            : Math.min(playlist_size, shuffle_amount);
    }

    async dynamicWeightedShuffle(playlist_id: string, shuffle_amount: number = 0) {
        try {
            /*OPTIONAL: ich frag hier einmal nur nach total, name und snapshot id und einmal nur nach den tracks
             *  beide calls brauchen fast 6 sekunden, obwohl das fragen nach den tracks einfach 26 mehr calls sind
             *  ich kann aber beim abfragen der playlists auch die tracks mit abfragen
             *  guck ob ich das alles in einen call packen kann, vielleicht geht das ja schneller und ich kann mir die 6 sekunden sparen*/
            const MIN_WEIGHT = 50;
            const BASE_WEIGHT = 500;
            //TODO: für die zwei konstanten hier bessere namen überlegen
            const WEIGHT_LOWERING_RATE = 0.5;
            const WEIGHT_INCREASE_RATE = 1.1;
            const playlist =
                await this.playlistService.getPlaylistByIDOnlyNecessaryInfo(playlist_id);
            //const playlist_name = playlist.name
            //this.helperService.printWithTimestamp(`Shuffling playlist "${playlist_name}"`);
            const playlist_size = playlist.tracks.total;
            const all_tracks =
                await this.trackService.getTracksOfPlaylistByIDOnlyNecessaryInfo(playlist_id);
            let new_snapshot_id = playlist.snapshot_id;
            let final_weighted_tracks: any[];

            shuffle_amount = this.determineShuffleAmount(playlist_size, shuffle_amount);

            //FALL playlist wurde schon mal geshuffled
            if (await this.lowDBService.doesPlaylistExist(playlist_id)) {
                let weighted_tracks = await this.lowDBService.getTracks(playlist_id);

                const snapshot_id_after_last_shuffle =
                    await this.lowDBService.getSnapshotID(playlist_id);

                //wenn seit letztem shuffle änderungen an der playlist gemacht wurden, so ist new_snapshot_id different
                if (new_snapshot_id !== snapshot_id_after_last_shuffle) {
                    //reduziert die track arrays auf ihre uris, macht den code einfach chilliger
                    const all_tracks_reduced_to_uris: string[] = all_tracks.map(
                        (track) => track.track.uri,
                    );
                    const weighted_tracks_reduced_to_uris: string[] = weighted_tracks.map(
                        (track) => track.uri,
                    );

                    //bestimmt die neuen tracks der playlist über differenz
                    const tracks_to_add = lodash.difference(
                        all_tracks_reduced_to_uris,
                        weighted_tracks_reduced_to_uris,
                    );

                    //bestimmt die zu löschenden tracks über differenz aber in andere richtung
                    const tracks_to_remove = lodash.difference(
                        weighted_tracks_reduced_to_uris,
                        all_tracks_reduced_to_uris,
                    );

                    //joa added die neuen tracks mit base weight und löscht die zu löschenden tracks
                    for (const track of tracks_to_add) {
                        await this.lowDBService.addTrack(playlist_id, track, BASE_WEIGHT);
                    }
                    for (const track of tracks_to_remove) {
                        await this.lowDBService.removeTrack(playlist_id, track);
                    }

                    /*OPTIONAL: hier mache ich die playlist änderungen und frag dann von der lowdb alle tracks ab
                     *  aber ich kann die änderungen doch auch gleichzeitig direkt an weighted_tracks lokal im code machen
                     *  dadurch spare ich mir den await call hier unten*/
                    weighted_tracks = await this.lowDBService.getTracks(playlist_id);
                }
                //holt sich die letzten geshuffleden tracks aus der lowdb und resetted sie dann
                const last_shuffled_tracks =
                    await this.lowDBService.getLastShuffledTracks(playlist_id);
                await this.lowDBService.clearLastShuffledTracks(playlist_id);

                for (const track of weighted_tracks) {
                    //für jeden track aus weighted tracks guckt er, ob er letztes mal geshuffled wurde
                    const isInShuffledTracks = last_shuffled_tracks.some(
                        (shuffledTrack) => shuffledTrack.uri === track.uri,
                    );

                    //abhängig davon ob der song letztes mal ausgewählt wurde passt er das weighting an
                    /*WICHTIG: google oder überleg dir eine bessere idee hier die weights anzupassen
                     *  halbieren bei auswahl und +10% ist glaube nicht so schlecht, aber es gibt safe fairere möglichkeiten*/
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
            //FALL playlist wurde noch nie geshuffled, daher kein eintrag in der lowdb
            else {
                await this.lowDBService.addPlaylist(playlist_id);
                for (const track of all_tracks) {
                    await this.lowDBService.addTrack(playlist_id, track.track.uri, BASE_WEIGHT);
                }
                /*OPTIONAL: ich muss ja nicht die tracks neu von der lowdb anfragen
                 *  stattdessen kann ich sie auch einfach mit base weight lokal speichern und damit arbeiten
                 *  dadurch spare ich mir das await hier, was an sich viel ist glaube ich*/
                final_weighted_tracks = await this.lowDBService.getTracks(playlist_id);
            }
            for (let i = 0; i < shuffle_amount; i++) {
                const chosen_track = this.helperService.getWeightedRandom(final_weighted_tracks);

                //Entfernt den track aus der roulette
                const index_in_weighted = final_weighted_tracks.findIndex(
                    (track) => track.uri === chosen_track.uri,
                );
                final_weighted_tracks.splice(index_in_weighted, 1);

                //findet den track in all_tracks und macht damit das reordering
                /*FIX: hier gabs mal nen fehler, dass der findIndex -1 returned hat
                 *  weil er den index nicht finden konnte, was dann halt einen spotify API error ausgelöst hat
                 *  beim reordering, weil range start = -1 natürlich falsch ist
                 *  der fehler kam bei tests von mir, aber ich konnte es danach nicht mehr wieder reproduzieren
                 *  nur damit du bescheid weißt*/
                const track_index = all_tracks.findIndex(
                    (track) => track.track.uri === chosen_track.uri,
                );
                new_snapshot_id = await this.playlistService.reorderPlaylistByID(
                    playlist_id,
                    track_index,
                    i,
                    new_snapshot_id,
                );

                //swapped den ausgewählten track in all_tracks nach vorne, damit die ermittlung der indizes konsistent bleibt
                all_tracks.splice(i, 0, all_tracks.splice(track_index, 1)[0]);

                //fügt den geshuffleden song zur lowdb hinzu für nächstes mal
                /*OPTIONAL: hier könnte man ja die geshufflden tracks in einer variablen halten
                 *  und dann mit einer neuen methode direkt in einem stück in die lowdb schreiben
                 *  also nicht für N tracks N awaits sondern nur ein await
                 *  aber joa weiß nicht ob das so großartig viel performance increase gibt tbh*/
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

    async insertionShuffle(playlist_id: string, shuffle_amount: any = null): Promise<any> {
        const playlist = await this.playlistService.getPlaylistByID(playlist_id);
        const playlist_size: number = playlist.tracks.total;
        let snapshot_id: string = playlist.snapshot_id;
        //this.helperService.printWithTimestamp(`Shuffling playlist "${playlist.name}`);
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

    //TODO: entf am ende, war zum testen
    async resetTestPlaylistCopy() {
        await this.spotifyApiService.sendPutCall(`playlists/6eEJAP7U12nFve8GLYQYnd/tracks`, {
            uris: [
                'spotify:track:2SuyyRbbciDBXEZerQ6PE1', //A
                'spotify:track:7t1FUkqJRdQdNrkjwfhq2H', //B
                'spotify:track:4WRObjXa0sC21wa3laZI1o', //C.
                'spotify:track:6E1ejRJAfE8BC4T1Dc8DNo', //D
                'spotify:track:76owXCPDaZVFNDmxEG4lV6', //E
                'spotify:track:275keYpPKRdTP0J1ctG9Ca', //F
                'spotify:track:3hpB5SlyESKXrmc6NUNQhd', //G
                'spotify:track:4fPFfvvegZQ12DIH1t3y4G', //H
                'spotify:track:2FQviMkaoixlgWuGL4u1EO', //I
                'spotify:track:2QuKpAI5kmgdwCbApdB4wT', //J
                'spotify:track:4jnyL0WIJB0iRRPFNj1BeL', //K
                'spotify:track:4Dk7gOIyslQ5tTkapDfYGh', //L
                'spotify:track:2iyEvZdipDeCmSW8v8PA32', //M
                'spotify:track:6DwF5IUONr6L0aSmxYyT0V', //N
                'spotify:track:2qgTvtCVbQ18SQ4ZDVUlMB', //O
                'spotify:track:7JiLZJlFMVANgEeBo7BvmL', //P
                'spotify:track:6upnQQE6IwsgPgxASNt7GM', //Q
                'spotify:track:45jaPXs1EROGdFRtT0T8Sx', //R
                'spotify:track:3ynqGo5QvzIvKnfAahXatd', //S
                'spotify:track:4db54JOdAm7OnDqjpWy1uj', //T
                'spotify:track:1fckVDRsaql38b9GfMjZ6x', //U
                'spotify:track:7BaQc1OYz1gMedTlMRRhkT', //V
                'spotify:track:2BWQIsuarfRoeqmnPvRO97', //W
                'spotify:track:5YUyW9opqNsMSEzzecZih1', //X
                'spotify:track:3e9z7v3fc6KBXACJwj0St1', //Y
                'spotify:track:4L8rZacefAFsbYBI6iqQgz', //Z
            ],
        });
    }
}
