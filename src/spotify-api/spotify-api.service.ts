import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AuthService } from '../auth/auth.service';
import { HelperService } from '../helper/helper.service';
import { firstValueFrom } from 'rxjs';
import { isAxiosError, Method } from 'axios';

type RequestOptions = {
    params?: Record<string, any>;
    data?: any;
};

/**
 * Kompakter Fehler für fehlgeschlagene Spotify-Calls
 * statt des riesigen Axios-Fehlerobjekts, das früher das Log zugemüllt hat
 */
export class SpotifyApiError extends Error {
    constructor(
        message: string,
        readonly status: number | undefined,
    ) {
        super(message);
        this.name = 'SpotifyApiError';
    }
}

@Injectable()
export class SpotifyApiService {
    private static readonly BASE_URL = 'https://api.spotify.com/v1/';
    private readonly max_attempts: number = 4;
    private readonly start_backoff_time: number = 1000;
    //zählt alle Calls seit dem Start, damit z.B. die Routine loggen kann, wie viele sie gebraucht hat
    private call_count: number = 0;
    constructor(
        private readonly httpService: HttpService,
        private readonly authService: AuthService,
        private readonly helperService: HelperService,
    ) {}

    getCallCount(): number {
        return this.call_count;
    }

    async sendGetCall(endpoint: string, params: Record<string, any> = {}): Promise<any> {
        return this.request('GET', endpoint, { params });
    }

    async sendPostCall(
        endpoint: string,
        data: any,
        params: Record<string, any> = {},
    ): Promise<any> {
        return this.request('POST', endpoint, { data, params });
    }

    async sendPutCall(endpoint: string, data: any, params: Record<string, any> = {}): Promise<any> {
        return this.request('PUT', endpoint, { data, params });
    }

    async sendDeleteCall(
        endpoint: string,
        data: any,
        params: Record<string, any> = {},
    ): Promise<any> {
        return this.request('DELETE', endpoint, { data, params });
    }

    /**
     * Lädt alle Seiten einer Liste (alles mit items + next, z.B. Playlist-Items oder eigene Playlists)
     * WICHTIG: wenn man fields angibt, muss next mit drin sein, sonst wird nur die erste Seite geladen
     */
    async getAllPages(endpoint: string, params: Record<string, any> = {}): Promise<any[]> {
        let items: any[] = [];
        let next_url: string | null = endpoint;
        let is_first_page = true;
        do {
            //next ist eine komplette URL, in der die params schon drin stecken
            const data: any = await this.sendGetCall(next_url, is_first_page ? params : {});
            items = items.concat(data.items);
            next_url = data.next ?? null;
            is_first_page = false;
        } while (next_url !== null);
        return items;
    }

    /**
     * Zentrale Methode für alle Calls, mit Retry bei:
     * 401 (Token abgelaufen, wird erneuert), 429 (Rate Limit, wartet so lange wie Spotify sagt),
     * 5xx (Spotify hat Probleme) und Netzwerkfehlern (Internet kurz weg)
     */
    private async request(method: Method, endpoint: string, options: RequestOptions): Promise<any> {
        const url = endpoint.startsWith('http') ? endpoint : SpotifyApiService.BASE_URL + endpoint;
        for (let attempt: number = 1; attempt <= this.max_attempts; attempt++) {
            const access_token = await this.authService.getAccessToken();
            this.call_count++;
            try {
                const response = await firstValueFrom(
                    this.httpService.request({
                        method,
                        url,
                        params: options.params,
                        data: options.data,
                        headers: { Authorization: `Bearer ${access_token}` },
                    }),
                );
                return response.data;
            } catch (error) {
                const wait_time = this.getRetryWaitTime(error, attempt, endpoint);
                if (wait_time === null || attempt === this.max_attempts) {
                    throw this.toSpotifyApiError(error, method, endpoint);
                }
                await new Promise((resolve) => setTimeout(resolve, wait_time));
            }
        }
        //wird nie erreicht, weil der letzte Versuch oben immer returned oder wirft
        throw new SpotifyApiError(`${method} ${endpoint} failed`, undefined);
    }

    /**
     * Gibt zurück, wie lange vor dem nächsten Versuch gewartet wird, oder null, wenn ein Retry sinnlos ist
     */
    private getRetryWaitTime(error: unknown, attempt: number, endpoint: string): number | null {
        if (!isAxiosError(error)) {
            return null;
        }
        const status = error.response?.status;
        const back_off_time = this.start_backoff_time * Math.pow(2, attempt - 1);

        if (status === 401) {
            this.helperService.printWithTimestamp(
                `401: Token expired, fetching new token...`,
                true,
            );
            this.authService.invalidateAccessToken();
            return 0;
        }
        if (status === 429) {
            const retry_after = Number(error.response?.headers['retry-after']);
            const wait_time = retry_after > 0 ? retry_after * 1000 : back_off_time;
            this.helperService.printWithTimestamp(
                `429: Rate Limit exceeded at ${endpoint}, waiting ${wait_time / 1000}s...`,
                true,
            );
            return wait_time;
        }
        if (status !== undefined && status >= 500) {
            this.helperService.printWithTimestamp(
                `${status}: Spotify server error at ${endpoint}, waiting ${back_off_time / 1000}s...`,
                true,
            );
            return back_off_time;
        }
        if (status === undefined) {
            this.helperService.printWithTimestamp(
                `Network error at ${endpoint} (${error.code}), waiting ${back_off_time / 1000}s...`,
                true,
            );
            return back_off_time;
        }
        return null;
    }

    private toSpotifyApiError(error: unknown, method: Method, endpoint: string): SpotifyApiError {
        if (isAxiosError(error)) {
            const status = error.response?.status;
            const details = error.response ? JSON.stringify(error.response.data) : error.code;
            return new SpotifyApiError(
                `${method} ${endpoint} failed (${status ?? 'no response'}): ${details}`,
                status,
            );
        }
        return new SpotifyApiError(`${method} ${endpoint} failed: ${String(error)}`, undefined);
    }
}
