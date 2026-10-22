import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HelperService } from '../helper/helper.service';
import { ShuffleService } from '../shuffle/shuffle.service';
import { PlaylistService } from '../playlist/playlist.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuthService } from '../auth/auth.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class MainService {
    constructor(
        private readonly configService: ConfigService,
        private readonly helperService: HelperService,
        private readonly shuffleService: ShuffleService,
        private readonly playlistService: PlaylistService,
        private readonly authService: AuthService,
        private readonly settingsService: SettingsService,
    ) {}

    /**
     * Wird einmal beim Start der App aufgerufen
     * Mit gespeichertem Login geht es direkt los, sonst wird der Spotify-Login im Browser geöffnet
     * Ohne Internet wird es jede Minute nochmal versucht, z.B. wenn das Netz beim Hochfahren noch nicht da ist
     */
    async startup() {
        const has_valid_login = await this.checkLoginWithRetry();
        if (has_valid_login === null) {
            this.helperService.printWithTimestamp(
                'Giving up on startup, Spotify is not reachable',
                true,
            );
        } else if (has_valid_login) {
            this.helperService.printWithTimestamp('Logged in with saved login');
            await this.startShuffleApplication(true);
        } else {
            //nach dem Login im Browser geht es im Callback /start weiter
            this.helperService.printWithTimestamp('Opening Spotify login in browser...');
            const port = this.configService.get<string>('PORT');
            await this.helperService.openInBrowser(`http://127.0.0.1:${port}/`);
        }
    }

    /**
     * true/false wie hasValidLogin, null wenn Spotify auch nach allen Versuchen nicht erreichbar war
     */
    private async checkLoginWithRetry(): Promise<boolean | null> {
        const max_attempts = 30;
        for (let attempt = 1; attempt <= max_attempts; attempt++) {
            try {
                return await this.authService.hasValidLogin();
            } catch (error) {
                this.helperService.printWithTimestamp(
                    `Could not reach Spotify (${error}), retrying in 60 seconds (${attempt}/${max_attempts})`,
                    true,
                );
                await this.helperService.wait(60);
            }
        }
        return null;
    }

    @Cron(CronExpression.EVERY_HOUR)
    async startShuffleApplication(is_initial: boolean = false) {
        if (!this.authService.isLoggedIn()) {
            this.helperService.printWithTimestamp('Not logged in yet, skipping shuffle...');
            return;
        }
        if (!(await this.settingsService.getSettings()).shuffle_enabled) {
            this.helperService.printWithTimestamp('Shuffling is disabled in settings.json');
            return;
        }
        try {
            await this.shuffleListenedPlaylists(is_initial);
        } catch (error) {
            //damit ein Fehler nicht als riesiger Stacktrace vom Scheduler im Log landet
            this.helperService.printWithTimestamp(`Shuffle run failed: ${error}`, true);
        }
    }

    private async shuffleListenedPlaylists(is_initial: boolean) {
        const look_x_hours_back = is_initial ? 24 : 2;
        const playlists_to_shuffle: string[] =
            await this.shuffleService.determinePlaylistsToShuffle(look_x_hours_back);
        if (playlists_to_shuffle.length === 0) {
            this.helperService.printWithTimestamp('Nothing to shuffle...');
            return;
        }
        for (const playlist_id of playlists_to_shuffle) {
            const playlist =
                await this.playlistService.getPlaylistByIDOnlyNecessaryInfo(playlist_id);
            this.helperService.printWithTimestamp(`Shuffling playlist "${playlist.name}"`);
            const start_time = Date.now();
            try {
                await this.shuffleService.dynamicWeightedShuffle(playlist_id);
            } catch (error) {
                //wenn irgendwie beim dynamic shuffle ein fehler aufkommt, dann gibt es noch den normalen shuffle als fail-save
                this.helperService.printWithTimestamp(
                    `Error occurred when trying dynamic shuffle, will instead use insertion shuffle: ${error}`,
                    true,
                );
                await this.shuffleService.insertionShuffle(playlist_id);
            }
            const end_time = Date.now();
            await this.playlistService.addCurrentTimestampToPlaylistDescription(playlist_id);
            this.helperService.printWithTimestamp(
                `Shuffle completed in ${this.helperService.getFormattedStringForDuration(end_time - start_time)}`,
            );
        }
        this.helperService.printWithTimestamp('Shuffle done!');
    }
}
