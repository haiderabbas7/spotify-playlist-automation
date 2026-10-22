import { Inject, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { HelperService } from '../helper/helper.service';
import { ShuffleService } from '../shuffle/shuffle.service';
import { PlaylistService } from '../playlist/playlist.service';
import { TrackService } from '../track/track.service';
import { UserService } from '../user/user.service';
import { LowDbService } from '../low-db/low-db.service';
import { promises as fs } from 'fs';
import { Cron, CronExpression } from '@nestjs/schedule';

//TODO: "AM ENDE: CODE AUFRÄUMEN"

@Injectable()
export class MainService {
    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        private readonly helperService: HelperService,
        private readonly shuffleService: ShuffleService,
        private readonly playlistService: PlaylistService,
        private readonly trackService: TrackService,
        private readonly userService: UserService,
        private readonly lowDBService: LowDbService,
    ) {}

    async testMain() {
        const playlist_id_testplaylistcopy = '4B2UOzffIG92Kh2PTPqgWi';
        await this.resetApplication();

        //Zum resetten der test playlist
        await this.shuffleService.resetTestPlaylistCopy();

        console.time('shuffle');
        //await this.playlistService.addCurrentTimestampToPlaylistDescription('0BfYlDPlZlFpDlJxxGNGWi')
        //await this.shuffleService.dynamicWeightedShuffle(playlist_id_testplaylistcopy);
        /*await this.cacheManager.set('test', 'test');
        const first = await this.cacheManager.get('test');
        console.log("first: " + first)
        await this.helperService.wait(5)
        const second = await this.cacheManager.get('test');
        console.log("second: " + second)*/
        console.timeEnd('shuffle');
    }

    @Cron(CronExpression.EVERY_HOUR)
    async startShuffleApplication(is_initial: boolean = false) {
        const look_x_hours_back = is_initial ? 24 : 2;
        const playlists_to_shuffle: string[] =
            await this.shuffleService.determinePlaylistsToShuffle(look_x_hours_back);
        if (playlists_to_shuffle === undefined || playlists_to_shuffle.length == 0) {
            this.helperService.printWithTimestamp('Nothing to shuffle...');
        } else {
            if (playlists_to_shuffle) {
                for (const playlist_id of playlists_to_shuffle) {
                    const playlist = await this.playlistService.getPlaylistByIDOnlyNecessaryInfo(playlist_id);
                    const playlist_name = playlist.name;
                    this.helperService.printWithTimestamp(`Shuffling playlist "${playlist_name}"`);
                    const start_time = Date.now();
                    try {
                        await this.shuffleService.dynamicWeightedShuffle(playlist_id);
                    } catch (error) {
                        //wenn irgendwie beim dynamic shuffle ein fehler aufkommt, dann gibt es noch den normalen shuffle als fail-save
                        this.helperService.printWithTimestamp(
                            `Error occurred when trying dynamic shuffle, will instead use insertion shuffle + ${error}`,
                        );
                        await this.shuffleService.insertionShuffle(playlist_id);
                    }
                    const end_time = Date.now();
                    await this.playlistService.addCurrentTimestampToPlaylistDescription(
                        playlist_id,
                    );
                    this.helperService.printWithTimestamp(
                        `Shuffle completed in ${this.helperService.getFormattedStringForDuration(end_time - start_time)}`,
                    );
                }
                this.helperService.printWithTimestamp('Shuffle done!');
            }
        }
    }

    async resetApplication() {
        //resetted die persistenten daten
        await this.lowDBService.resetDB();

        //Logs löschen
        await fs.writeFile('logs/pm2.log', '');

        this.helperService.printWithTimestamp('Application was reset');
    }
}
