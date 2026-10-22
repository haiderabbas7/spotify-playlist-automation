import { Injectable } from '@nestjs/common';

@Injectable()
export class HelperService {
    //open ist ein ES modul und kann daher NUR so importiert werden
    async openInBrowser(url: string) {
        const module = await (eval(`import('open')`) as Promise<{
            default: (target: string) => Promise<unknown>;
        }>);
        await module.default(url);
    }

    /**
     * Mein "eigener" weighted random object algo (hab ich vom package weighted-random-object geklaut)
     * man gibt einfach ein array an Elementen ein, wobei jedes Element ein attribut weight enthalten soll
     * und er gibt dir ein zufälliges objekt zurück OHNE ES ZU ENTFERNEN
     */
    getWeightedRandom<T extends { weight: number }>(objects: T[]): T | undefined {
        // Berechne das Gesamtgewicht
        const totalWeight = objects.reduce((agg, object) => agg + object.weight, 0);

        // Generiere eine Zufallszahl im Bereich des Gesamtgewichts
        const randomNumber = Math.random() * totalWeight;

        // Finde das Objekt, dessen Gewicht die Zufallszahl überschreitet
        let weightSum = 0;
        return objects.find((object) => {
            weightSum += object.weight;
            return randomNumber <= weightSum;
        });
    }

    /**
     * spotify:playlist:abc => abc, funktioniert für alle Spotify URIs (track, album, ...)
     */
    extractIDfromSpotifyURI(uri: string): string {
        return uri.substring(uri.lastIndexOf(':') + 1);
    }

    /**
     * Spotify liefert Playlist-Beschreibungen HTML-kodiert (&quot; statt "), das wird hier rückgängig gemacht
     * ohne das würde beim Zurückschreiben einer Beschreibung aus " irgendwann &amp;quot; werden
     */
    decodeHTMLEntities(text: string): string {
        const named: Record<string, string> = {
            amp: '&',
            quot: '"',
            apos: "'",
            lt: '<',
            gt: '>',
            nbsp: ' ',
        };
        return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match: string, entity: string) => {
            if (entity.startsWith('#x') || entity.startsWith('#X')) {
                return String.fromCodePoint(parseInt(entity.substring(2), 16));
            }
            if (entity.startsWith('#')) {
                return String.fromCodePoint(parseInt(entity.substring(1), 10));
            }
            return named[entity.toLowerCase()] ?? match;
        });
    }

    async wait(seconds: number) {
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }

    getCurrentTimestampFormatted(): string {
        const now = new Date();
        return now
            .toLocaleString('de-DE', {
                timeZone: 'Europe/Berlin',
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
            })
            .replace(',', '');
    }

    /**
     * hab ich von GPT, printed einfach (DD.MM.YY HH:MM) message
     */
    printWithTimestamp(message: string, is_error: boolean = false) {
        const formattedDate = this.getCurrentTimestampFormatted();
        if (is_error) {
            console.error(`(${formattedDate}) ${message}`);
        } else {
            console.log(`(${formattedDate}) ${message}`);
        }
    }

    /** Hab ich von GPT, man übergibt eine Dauer in Millisekunden an, zb durch eine Date differenz
     * und er returned einen schönen string abhängig von der Länge
     * Dauer kürzer als eine Minute => SS.MSMS seconds, zb 15.37 seconds
     * Dauer länger als eine Minute => MM:SS minutes, zb 1:23 minutes
     */
    getFormattedStringForDuration(durationMs: number): string {
        const minutes = Math.floor(durationMs / 60000);
        const seconds = (durationMs % 60000) / 1000;

        if (minutes > 0) {
            return `${minutes}:${String(Math.floor(seconds)).padStart(2, '0')} minutes`;
        } else {
            return `${seconds.toFixed(2)} seconds`;
        }
    }
}
