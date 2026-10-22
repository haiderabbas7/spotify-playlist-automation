import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import * as querystring from 'node:querystring';
import { promises as fs } from 'fs';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { HelperService } from '../helper/helper.service';

type StoredTokens = {
    access_token: string;
    refresh_token: string;
    //Zeitpunkt in ms (UTC), ab dem der access token nicht mehr gilt
    expires_at: number;
    scope: string;
};

//Antwort von accounts.spotify.com/api/token, refresh_token und scope fehlen beim Refresh manchmal
type TokenResponse = {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
};

/**
 * Wird geworfen, wenn kein gültiger Login da ist und der User sich im Browser neu einloggen muss
 */
export class LoginRequiredError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LoginRequiredError';
    }
}

@Injectable()
export class AuthService {
    //alle Rechte, die die App braucht. Kommt hier was dazu, muss der User einmal neu zustimmen
    static readonly SCOPES: string[] = [
        'user-read-playback-state',
        'user-read-currently-playing',
        'user-read-recently-played',
        'playlist-read-private',
        'playlist-read-collaborative',
        'playlist-modify-public',
        'playlist-modify-private',
        'user-library-read',
        'user-library-modify',
    ];
    private static readonly TOKEN_FILE = 'tokens.json';
    //access token wird schon eine Minute vor Ablauf erneuert
    private static readonly EXPIRY_BUFFER_MS = 60 * 1000;

    private readonly client_id: string;
    private readonly client_secret: string;
    private tokens: StoredTokens | null = null;
    //laufender Refresh, damit parallele Calls nicht mehrere Refreshes gleichzeitig anstoßen
    private refresh_in_progress: Promise<string> | null = null;

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
        private readonly helperService: HelperService,
    ) {
        this.client_id = this.configService.get<string>('CLIENT_ID') ?? '';
        this.client_secret = this.configService.get<string>('CLIENT_SECRET') ?? '';
    }

    getRedirectURI(): string {
        return `http://127.0.0.1:${this.configService.get<string>('PORT')}/start`;
    }

    getLoginURL(): string {
        return (
            'https://accounts.spotify.com/authorize?' +
            querystring.stringify({
                response_type: 'code',
                client_id: this.client_id,
                scope: AuthService.SCOPES.join(' '),
                redirect_uri: this.getRedirectURI(),
            })
        );
    }

    /**
     * Prüft beim Start, ob ein gespeicherter Login benutzt werden kann
     * true: es gibt einen gültigen Token mit allen nötigen Scopes, es muss sich niemand einloggen
     * false: der User muss sich im Browser einloggen (kein Token, Token ungültig oder Scopes fehlen)
     * Netzwerkfehler werden weitergeworfen, weil man dann nicht weiß, ob der Login gültig ist
     */
    async hasValidLogin(): Promise<boolean> {
        this.tokens = await this.readTokenFile();
        if (!this.tokens) {
            this.helperService.printWithTimestamp('No saved login found');
            return false;
        }
        const missing_scopes = this.getMissingScopes(this.tokens.scope);
        if (missing_scopes.length > 0) {
            this.helperService.printWithTimestamp(
                `Saved login is missing permissions (${missing_scopes.join(', ')}), new login required`,
            );
            this.tokens = null;
            return false;
        }
        try {
            await this.getAccessToken();
            return true;
        } catch (error) {
            if (error instanceof LoginRequiredError) {
                this.helperService.printWithTimestamp(error.message);
                this.tokens = null;
                return false;
            }
            throw error;
        }
    }

    isLoggedIn(): boolean {
        return this.tokens !== null;
    }

    async getAccessToken(): Promise<string> {
        if (!this.tokens) {
            throw new LoginRequiredError('Not logged in');
        }
        if (Date.now() < this.tokens.expires_at - AuthService.EXPIRY_BUFFER_MS) {
            return this.tokens.access_token;
        }
        if (!this.refresh_in_progress) {
            this.refresh_in_progress = this.refreshToken().finally(() => {
                this.refresh_in_progress = null;
            });
        }
        return this.refresh_in_progress;
    }

    /**
     * Wird vom SpotifyApiService bei einem 401 aufgerufen, damit beim nächsten getAccessToken neu geholt wird
     */
    invalidateAccessToken() {
        if (this.tokens) {
            this.tokens.expires_at = 0;
        }
    }

    async requestTokens(code: string) {
        const response = await this.sendTokenRequest({
            grant_type: 'authorization_code',
            code,
            redirect_uri: this.getRedirectURI(),
        });
        await this.saveTokens(response);
    }

    private async refreshToken(): Promise<string> {
        if (!this.tokens) {
            throw new LoginRequiredError('Not logged in');
        }
        const response = await this.sendTokenRequest({
            grant_type: 'refresh_token',
            refresh_token: this.tokens.refresh_token,
        });
        await this.saveTokens(response);
        return this.tokens.access_token;
    }

    private async saveTokens(response: TokenResponse) {
        this.tokens = {
            access_token: response.access_token,
            //Spotify schickt beim Refresh nicht immer einen neuen refresh token mit, dann bleibt der alte gültig
            refresh_token: response.refresh_token ?? this.tokens?.refresh_token ?? '',
            expires_at: Date.now() + response.expires_in * 1000,
            scope: response.scope ?? this.tokens?.scope ?? '',
        };
        await fs.writeFile(AuthService.TOKEN_FILE, JSON.stringify(this.tokens, null, 4));
    }

    private async readTokenFile(): Promise<StoredTokens | null> {
        try {
            const content = await fs.readFile(AuthService.TOKEN_FILE, 'utf8');
            const tokens = JSON.parse(content) as StoredTokens;
            return tokens.refresh_token ? tokens : null;
        } catch {
            //Datei existiert nicht oder ist kaputt, dann einfach neu einloggen
            return null;
        }
    }

    private getMissingScopes(granted_scope: string): string[] {
        const granted = granted_scope.split(' ');
        return AuthService.SCOPES.filter((scope) => !granted.includes(scope));
    }

    private async sendTokenRequest(post_data: Record<string, string>): Promise<TokenResponse> {
        try {
            const response = await lastValueFrom(
                this.httpService.post<TokenResponse>(
                    'https://accounts.spotify.com/api/token',
                    querystring.stringify(post_data),
                    {
                        headers: {
                            Authorization:
                                'Basic ' +
                                Buffer.from(this.client_id + ':' + this.client_secret).toString(
                                    'base64',
                                ),
                            'Content-Type': 'application/x-www-form-urlencoded',
                        },
                    },
                ),
            );
            return response.data;
        } catch (error) {
            const axiosError = error as AxiosError<{ error?: string }>;
            //400 invalid_grant heißt, der refresh token oder code ist ungültig (z.B. Zugriff in Spotify entzogen)
            if (axiosError.response?.status === 400) {
                throw new LoginRequiredError(
                    `Spotify rejected the login (${axiosError.response.data?.error ?? 'unknown'}), new login required`,
                );
            }
            //alles andere (kein Internet, Spotify down) wird weitergeworfen und nicht als ungültiger Login behandelt
            throw error;
        }
    }
}
