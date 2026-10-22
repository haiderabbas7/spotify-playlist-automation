import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { AuthService } from '../auth/auth.service';
import { HelperService } from '../helper/helper.service';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

@Injectable()
export class SpotifyApiService {
    private readonly max_attempts: number = 3;
    private readonly start_backoff_time: number = 1000;
    constructor(
        private readonly configService: ConfigService,
        private readonly httpService: HttpService,
        private readonly authService: AuthService,
        private readonly helperService: HelperService,
    ) {}

    //TODO: "ALT: ZENTRALE ERROR HANDLING METHODE SCHREIBEN"

    async sendPutCall(endpoint: string, data: any, params: Record<string, any> = {}): Promise<any> {
        const back_off_time = this.start_backoff_time;
        let access_token = await this.authService.getAccessToken();

        for (let attempts: number = 1; attempts <= this.max_attempts; attempts++) {
            try {
                const response = await firstValueFrom(
                    this.httpService.put(`https://api.spotify.com/v1/${endpoint}`, data, {
                        headers: { Authorization: `Bearer ${access_token}` },
                        params,
                    }),
                );

                if (response.status >= 200 && response.status < 300) {
                    /*return {
                        data: response.data,
                        status: response.status,
                    };*/
                    return response.data;
                }

                // Fehler für Status 400-599
                throw new Error(`API call failed with status ${response.status}`);
            } catch (error) {
                const axiosError = error as AxiosError;
                const status = axiosError.response?.status;

                if (status === 401) {
                    // Token erneuern
                    this.helperService.printWithTimestamp(
                        `${status}: Token expired, fetching new token...`,
                        true,
                    );
                    this.authService.invalidateAccessToken();
                    access_token = await this.authService.getAccessToken();
                    /*} else if (status === 404) {
                        // Behandle 404 hier, ohne zu werfen
                        return { data: null, status: 404 }; // oder was auch immer du zurückgeben möchtest*/
                } else if (status === 429 || status === 500) {
                    // Exponential Backoff
                    const wait_time = back_off_time * Math.pow(2, attempts - 1);
                    if (status === 429) {
                        this.helperService.printWithTimestamp(
                            `${status}: Rate Limit exceeded at ${endpoint}, waiting ${wait_time / 1000}s...`,
                            true,
                        );
                    } else {
                        this.helperService.printWithTimestamp(
                            `${status}: Timeout, waiting ${wait_time / 1000}s...`,
                            true,
                        );
                    }
                    await new Promise((resolve) => setTimeout(resolve, wait_time));
                } else {
                    this.helperService.printWithTimestamp(
                        `Unknown error (${status}): ${axiosError.response?.data}`,
                        true,
                    );
                    throw error;
                }
            }
        }
        // Wenn alle Versuche fehlschlagen:
        throw new Error(`Maximale Anzahl an Versuchen erreicht für ${endpoint}`);
    }

    async sendGetCall(endpoint: string, params: Record<string, any> = {}): Promise<any> {
        const back_off_time = this.start_backoff_time; // Startwert für Backoff
        let access_token = await this.authService.getAccessToken(); // Token einmalig holen

        for (let attempts: number = 1; attempts <= this.max_attempts; attempts++) {
            try {
                const response = await firstValueFrom(
                    this.httpService.get(`https://api.spotify.com/v1/${endpoint}`, {
                        headers: { Authorization: `Bearer ${access_token}` },
                        params,
                    }),
                );

                if (response.status >= 200 && response.status < 300) {
                    /*return {
                        data: response.data,
                        status: response.status,
                    };*/
                    return response.data;
                }

                // Fällt in den Bereich 400-599 und ist kein 2xx Status
                throw new Error(`API call failed with status ${response.status}`);
            } catch (error) {
                const axiosError = error as AxiosError;
                const status = axiosError.response?.status;

                if (status === 401) {
                    // Token erneuern
                    this.helperService.printWithTimestamp(
                        `${status}: Token expired, fetching new token...`,
                        true,
                    );
                    this.authService.invalidateAccessToken();
                    access_token = await this.authService.getAccessToken();
                    /*} else if (status === 404) {
                    // Behandle 404 hier, ohne zu werfen
                    return { data: null, status: 404 }; // oder was auch immer du zurückgeben möchtest*/
                } else if (status === 429 || status === 500) {
                    // Exponential Backoff
                    const wait_time = back_off_time * Math.pow(2, attempts - 1);
                    if (status === 429) {
                        this.helperService.printWithTimestamp(
                            `${status}: Rate Limit exceeded at ${endpoint}, waiting ${wait_time / 1000}s...`,
                        );
                    } else {
                        this.helperService.printWithTimestamp(
                            `${status}: Rate Limit exceeded at ${endpoint}, waiting ${wait_time / 1000}s...`,
                        );
                    }
                    await new Promise((resolve) => setTimeout(resolve, wait_time));
                } else {
                    this.helperService.printWithTimestamp(
                        `Unknown error (${status}): ${axiosError.response?.data}`,
                        true,
                    );
                    throw error;
                }
            }
        }
        // Wenn alle Versuche fehlschlagen:
        throw new Error(`Maximale Anzahl an Versuchen erreicht für ${endpoint}`);
    }
}
