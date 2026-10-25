import { Injectable } from '@nestjs/common';

@Injectable()
export class HelperService {
    //open is an ES module and can therefore ONLY be imported like this
    async openInBrowser(url: string) {
        const module = await (eval(`import('open')`) as Promise<{
            default: (target: string) => Promise<unknown>;
        }>);
        await module.default(url);
    }

    /**
     * Weighted random pick, based on the package weighted-random-object
     * takes an array of elements, each element needs a weight attribute
     * and returns a random element WITHOUT REMOVING IT
     */
    getWeightedRandom<T extends { weight: number }>(objects: T[]): T | undefined {
        // sum of all weights
        const totalWeight = objects.reduce((agg, object) => agg + object.weight, 0);

        // random number within the total weight
        const randomNumber = Math.random() * totalWeight;

        // find the element whose cumulative weight exceeds the random number
        let weightSum = 0;
        return objects.find((object) => {
            weightSum += object.weight;
            return randomNumber <= weightSum;
        });
    }

    /**
     * spotify:playlist:abc => abc, works for all Spotify URIs (track, album, ...)
     */
    extractIDfromSpotifyURI(uri: string): string {
        return uri.substring(uri.lastIndexOf(':') + 1);
    }

    /**
     * Spotify returns playlist descriptions HTML encoded (&quot; instead of "), this reverts it
     * without it, writing a description back would eventually turn " into &amp;quot;
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

    /**
     * Waits the given number of seconds
     */
    async wait(seconds: number) {
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }

    /**
     * Current time in German time (Europe/Berlin) as "DD.MM. HH:MM", for logs and the shuffle timestamp
     */
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
     * Prints (DD.MM. HH:MM) message
     */
    printWithTimestamp(message: string, is_error: boolean = false) {
        const formattedDate = this.getCurrentTimestampFormatted();
        if (is_error) {
            console.error(`(${formattedDate}) ${message}`);
        } else {
            console.log(`(${formattedDate}) ${message}`);
        }
    }

    /** Takes a duration in milliseconds, e.g. a date difference
     * and returns a readable string depending on the length
     * shorter than a minute => SS.MS seconds, e.g. 15.37 seconds
     * longer than a minute => MM:SS minutes, e.g. 1:23 minutes
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
