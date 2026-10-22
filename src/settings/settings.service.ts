import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { HelperService } from '../helper/helper.service';

export type Settings = {
    //false: es wird nicht mehr geshuffled, alles andere (Login usw.) läuft weiter
    shuffle_enabled: boolean;
};

const DEFAULT_SETTINGS: Settings = {
    shuffle_enabled: true,
};

/**
 * Liest settings.json im Projekt-Root, die Datei ist zum manuellen Bearbeiten gedacht
 * wird bei jedem Aufruf neu gelesen, damit Änderungen ohne Neustart greifen
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
            await fs.writeFile(
                SettingsService.SETTINGS_FILE,
                JSON.stringify(DEFAULT_SETTINGS, null, 4),
            );
            this.helperService.printWithTimestamp('Created settings.json with default values');
            return { ...DEFAULT_SETTINGS };
        }
        try {
            return { ...DEFAULT_SETTINGS, ...(JSON.parse(content) as Partial<Settings>) };
        } catch {
            this.helperService.printWithTimestamp(
                'settings.json is not valid JSON, using default values',
                true,
            );
            return { ...DEFAULT_SETTINGS };
        }
    }
}
