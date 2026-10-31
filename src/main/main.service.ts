import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HelperService } from '../helper/helper.service';
import { ShuffleService } from '../shuffle/shuffle.service';
import { PlaylistService } from '../playlist/playlist.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuthService } from '../auth/auth.service';
import { SettingsService } from '../settings/settings.service';
import { RoutineService } from '../routine/routine.service';

@Injectable()
export class MainService {
    constructor(
        private readonly configService: ConfigService,
        private readonly helperService: HelperService,
        private readonly shuffleService: ShuffleService,
        private readonly playlistService: PlaylistService,
        private readonly authService: AuthService,
        private readonly settingsService: SettingsService,
        private readonly routineService: RoutineService,
    ) {}

    //all runs (routine + shuffle) are queued here one after another, so two never run at the same time
    private task_chain: Promise<void> = Promise.resolve();
    //so "shuffling is disabled" is logged once and not every hour
    private shuffle_disabled_logged: boolean = false;

    /**
     * Called once when the app starts
     * With a saved login it starts right away, otherwise the Spotify login is opened in the browser
     * Without internet it is retried every minute, e.g. when the network is not up yet after booting
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
            //after the login in the browser it continues in the callback /start
            this.helperService.printWithTimestamp('Opening Spotify login in browser...');
            const port = this.configService.get<string>('PORT');
            await this.helperService.openInBrowser(`http://127.0.0.1:${port}/`);
        }
    }

    /**
     * true/false like hasValidLogin, null if Spotify was not reachable even after all attempts
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

    /**
     * Runs every hour, once after startup (is_initial) and manually via /shuffle
     * first the queue routine (always on startup, otherwise only if it did not run for over 20 hours), then the shuffle
     */
    @Cron(CronExpression.EVERY_HOUR)
    async startShuffleApplication(is_initial: boolean = false) {
        await this.runExclusive(async () => {
            if (!this.authService.isLoggedIn()) {
                this.helperService.printWithTimestamp('Not logged in yet, skipping...');
                return;
            }
            await this.runRoutine(is_initial);
            if (!(await this.settingsService.getSettings()).shuffle_enabled) {
                if (!this.shuffle_disabled_logged) {
                    this.helperService.printWithTimestamp('Shuffling is disabled in settings.json');
                    this.shuffle_disabled_logged = true;
                }
                return;
            }
            this.shuffle_disabled_logged = false;
            try {
                await this.shuffleListenedPlaylists(is_initial);
            } catch (error) {
                //so an error does not end up in the log as a huge stack trace from the scheduler
                this.helperService.printWithTimestamp(`Shuffle run failed: ${error}`, true);
            }
        });
    }

    /**
     * Triggers only the routine, right away and regardless of when it last ran (route /routine, for testing)
     */
    async startRoutineNow() {
        await this.runExclusive(async () => {
            if (!this.authService.isLoggedIn()) {
                this.helperService.printWithTimestamp('Not logged in yet, skipping...');
                return;
            }
            await this.runRoutine(true);
        });
    }

    /**
     * Starts the routine if force is set or it is due, errors are only logged
     */
    private async runRoutine(force: boolean) {
        try {
            if (force || (await this.routineService.isDue())) {
                await this.routineService.run();
            }
        } catch (error) {
            //an error in the routine must not prevent the shuffle
            this.helperService.printWithTimestamp(`Routine failed: ${error}`, true);
        }
    }

    /**
     * Appends a task to the queue, it only starts when the previous one is done
     */
    private async runExclusive(task: () => Promise<void>) {
        const run = this.task_chain.then(task);
        this.task_chain = run.catch(() => undefined);
        await run;
    }

    /**
     * Shuffles all playlists played in the last 24 (startup) or 2 hours and sets the timestamp afterwards
     */
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
                //if the dynamic shuffle fails for some reason, the plain shuffle is used as a fallback
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
