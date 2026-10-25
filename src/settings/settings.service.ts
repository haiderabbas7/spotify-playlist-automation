import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { HelperService } from '../helper/helper.service';

export type Settings = {
    //false: no more shuffling, everything else (login etc.) keeps running
    shuffle_enabled: boolean;
    //false: the queue routine does not run
    routine_enabled: boolean;
    //true: the routine changes nothing and only logs what it would do
    routine_dry_run: boolean;
};

const DEFAULT_SETTINGS: Settings = {
    shuffle_enabled: true,
    routine_enabled: true,
    routine_dry_run: true,
};

/**
 * Reads settings.json in the project root, the file is meant to be edited by hand
 * it is read again on every call, so changes apply without a restart
 * missing entries (e.g. after an update) are filled with default values and written to the file
 */
@Injectable()
export class SettingsService {
    private static readonly SETTINGS_FILE = 'settings.json';

    constructor(private readonly helperService: HelperService) {}

    /**
     * Reads settings.json, creates it if needed and adds missing entries
     */
    async getSettings(): Promise<Settings> {
        let content: string;
        try {
            content = await fs.readFile(SettingsService.SETTINGS_FILE, 'utf8');
        } catch {
            //if the file does not exist yet, it is created with the default values
            await this.writeSettings(DEFAULT_SETTINGS);
            this.helperService.printWithTimestamp('Created settings.json with default values');
            return { ...DEFAULT_SETTINGS };
        }
        let saved_settings: Partial<Settings>;
        try {
            saved_settings = JSON.parse(content) as Partial<Settings>;
        } catch {
            this.helperService.printWithTimestamp(
                'settings.json is not valid JSON, using default values',
                true,
            );
            return { ...DEFAULT_SETTINGS };
        }
        const settings = { ...DEFAULT_SETTINGS, ...saved_settings };
        const missing_keys = Object.keys(DEFAULT_SETTINGS).filter(
            (key) => !(key in saved_settings),
        );
        if (missing_keys.length > 0) {
            await this.writeSettings(settings);
            this.helperService.printWithTimestamp(
                `Added missing settings to settings.json: ${missing_keys.join(', ')}`,
            );
        }
        return settings;
    }

    /**
     * Writes the settings formatted to settings.json
     */
    private async writeSettings(settings: Settings) {
        await fs.writeFile(SettingsService.SETTINGS_FILE, JSON.stringify(settings, null, 4));
    }
}
