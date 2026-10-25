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
    //point in time in ms (UTC) from which the access token is no longer valid
    expires_at: number;
    scope: string;
};

//response of accounts.spotify.com/api/token, refresh_token and scope are sometimes missing on refresh
type TokenResponse = {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
};

/**
 * Thrown when there is no valid login and the user has to log in again in the browser
 */
export class LoginRequiredError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LoginRequiredError';
    }
}

@Injectable()
export class AuthService {
    //all permissions the app needs. If one is added here, the user has to consent once again
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
    //the access token is renewed one minute before it expires
    private static readonly EXPIRY_BUFFER_MS = 60 * 1000;

    private readonly client_id: string;
    private readonly client_secret: string;
    private tokens: StoredTokens | null = null;
    //refresh in progress, so parallel calls do not start several refreshes at once
    private refresh_in_progress: Promise<string> | null = null;

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
        private readonly helperService: HelperService,
    ) {
        this.client_id = this.configService.get<string>('CLIENT_ID') ?? '';
        this.client_secret = this.configService.get<string>('CLIENT_SECRET') ?? '';
    }

    /**
     * Callback address after the Spotify login, must be registered exactly like this in the Spotify Developer Dashboard
     */
    getRedirectURI(): string {
        return `http://127.0.0.1:${this.configService.get<string>('PORT')}/start`;
    }

    /**
     * Address of the Spotify login page with all scopes, the route / redirects there
     */
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
     * Checks on startup whether a saved login can be used
     * true: there is a valid token with all required scopes, nobody has to log in
     * false: the user has to log in in the browser (no token, invalid token or missing scopes)
     * network errors are rethrown, because then it is unknown whether the login is valid
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

    /**
     * true as soon as a valid login was loaded or newly requested
     */
    isLoggedIn(): boolean {
        return this.tokens !== null;
    }

    /**
     * Returns a valid access token, if it is (almost) expired it is renewed with the refresh token first
     * throws LoginRequiredError if there is no login
     */
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
     * Called by SpotifyApiService on a 401, so the next getAccessToken requests a new token
     */
    invalidateAccessToken() {
        if (this.tokens) {
            this.tokens.expires_at = 0;
        }
    }

    /**
     * Exchanges the code from the login callback for tokens and saves them in tokens.json
     */
    async requestTokens(code: string) {
        const response = await this.sendTokenRequest({
            grant_type: 'authorization_code',
            code,
            redirect_uri: this.getRedirectURI(),
        });
        await this.saveTokens(response);
    }

    /**
     * Gets a new access token with the refresh token and saves it
     */
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

    /**
     * Saves the tokens in memory and in tokens.json
     */
    private async saveTokens(response: TokenResponse) {
        this.tokens = {
            access_token: response.access_token,
            //Spotify does not always send a new refresh token on refresh, then the old one stays valid
            refresh_token: response.refresh_token ?? this.tokens?.refresh_token ?? '',
            expires_at: Date.now() + response.expires_in * 1000,
            scope: response.scope ?? this.tokens?.scope ?? '',
        };
        await fs.writeFile(AuthService.TOKEN_FILE, JSON.stringify(this.tokens, null, 4));
    }

    /**
     * Reads tokens.json, null if the file is missing, broken or contains no refresh token
     */
    private async readTokenFile(): Promise<StoredTokens | null> {
        try {
            const content = await fs.readFile(AuthService.TOKEN_FILE, 'utf8');
            const tokens = JSON.parse(content) as StoredTokens;
            return tokens.refresh_token ? tokens : null;
        } catch {
            //file does not exist or is broken, then just log in again
            return null;
        }
    }

    /**
     * The scopes from SCOPES that the saved login has not consented to yet
     */
    private getMissingScopes(granted_scope: string): string[] {
        const granted = granted_scope.split(' ');
        return AuthService.SCOPES.filter((scope) => !granted.includes(scope));
    }

    /**
     * POST to accounts.spotify.com/api/token, for the first login and for every refresh
     * a 400 becomes LoginRequiredError, everything else (e.g. no internet) is rethrown as is
     */
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
            //400 invalid_grant means the refresh token or code is invalid (e.g. access revoked in Spotify)
            if (axiosError.response?.status === 400) {
                throw new LoginRequiredError(
                    `Spotify rejected the login (${axiosError.response.data?.error ?? 'unknown'}), new login required`,
                );
            }
            //everything else (no internet, Spotify down) is rethrown and not treated as an invalid login
            throw error;
        }
    }
}
