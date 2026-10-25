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
 * Compact error for failed Spotify calls
 * instead of the huge Axios error object that used to clutter the log
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
    //counts all calls since startup, so e.g. the routine can log how many it needed
    private call_count: number = 0;
    constructor(
        private readonly httpService: HttpService,
        private readonly authService: AuthService,
        private readonly helperService: HelperService,
    ) {}

    /**
     * Number of all API calls since the app started
     */
    getCallCount(): number {
        return this.call_count;
    }

    /**
     * GET on a Spotify endpoint, e.g. "me/playlists", returns the response
     */
    async sendGetCall(endpoint: string, params: Record<string, any> = {}): Promise<any> {
        return this.request('GET', endpoint, { params });
    }

    /**
     * POST on a Spotify endpoint, data is the JSON body
     */
    async sendPostCall(
        endpoint: string,
        data: any,
        params: Record<string, any> = {},
    ): Promise<any> {
        return this.request('POST', endpoint, { data, params });
    }

    /**
     * PUT on a Spotify endpoint, data is the JSON body
     */
    async sendPutCall(endpoint: string, data: any, params: Record<string, any> = {}): Promise<any> {
        return this.request('PUT', endpoint, { data, params });
    }

    /**
     * DELETE on a Spotify endpoint, data is the JSON body
     */
    async sendDeleteCall(
        endpoint: string,
        data: any,
        params: Record<string, any> = {},
    ): Promise<any> {
        return this.request('DELETE', endpoint, { data, params });
    }

    /**
     * Loads all pages of a list (anything with items + next, e.g. playlist items or own playlists)
     * IMPORTANT: if fields is set, it has to include next, otherwise only the first page is loaded
     */
    async getAllPages(endpoint: string, params: Record<string, any> = {}): Promise<any[]> {
        let items: any[] = [];
        let next_url: string | null = endpoint;
        let is_first_page = true;
        do {
            //next is a complete URL that already contains the params
            const data: any = await this.sendGetCall(next_url, is_first_page ? params : {});
            items = items.concat(data.items);
            next_url = data.next ?? null;
            is_first_page = false;
        } while (next_url !== null);
        return items;
    }

    /**
     * Central method for all calls, with retry on:
     * 401 (token expired, gets renewed), 429 (rate limit, waits as long as Spotify says),
     * 5xx (Spotify has problems) and network errors (internet briefly gone)
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
        //never reached, because the last attempt above always returns or throws
        throw new SpotifyApiError(`${method} ${endpoint} failed`, undefined);
    }

    /**
     * Returns how long to wait before the next attempt, or null if a retry makes no sense
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

    /**
     * Turns an Axios error into a short SpotifyApiError with method, endpoint, status and Spotify's message
     */
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
