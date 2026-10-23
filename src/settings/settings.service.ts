import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { HelperService } from '../helper/helper.service';

export type Settings = {
    //false: es wird nicht mehr geshuffled, alles andere (Login usw.) läuft weiter
    shuffle_enabled: boolean;
    //false: die Queue-Routine läuft nicht
    routine_enabled: boolean;
    //true: die Routine ändert nichts, sondern schreibt nur ins Log, was sie tun würde
    routine_dry_run: boolean;
    //Sammel-Playlist (BEHALTEN), aus der die Routine die Songs holt
    collect_playlist_id: string;
    //Playlist für Songs ohne eindeutige Main (EINSORTIEREN)
    fallback_playlist_id: string;
};

const DEFAULT_SETTINGS: Settings = {
    shuffle_enabled: true,
    routine_enabled: true,
    routine_dry_run: true,
    collect_playlist_id: '3eFrSUEGWIFA3lu2ijpPCO',
    fallback_playlist_id: '2WN4El6aAabsDquhsYj1w5',
};

/**
 * Liest settings.json im Projekt-Root, die Datei ist zum manuellen Bearbeiten gedacht
 * wird bei jedem Aufruf neu gelesen, damit Änderungen ohne Neustart greifen
 * fehlen Einträge (z.B. nach einem Update), werden sie mit Standardwerten ergänzt und in die Datei geschrieben
 */
@Injectable()
export class SettingsService {
    private static readonly SETTINGS_FILE = 'settings.json';

    constructor(private readonly helperService: HelperService) {}

    async getSettings(): Promise<Settings> {
        let content: string;
        try {
            content = await fs.readFile(SettingsService.SETTINGS_FILE, 'utf8');
        } catch {
            //gibt es die Datei noch nicht, wird sie mit den Standardwerten angelegt
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

    private async writeSettings(settings: Settings) {
        await fs.writeFile(SettingsService.SETTINGS_FILE, JSON.stringify(settings, null, 4));
    }
}
