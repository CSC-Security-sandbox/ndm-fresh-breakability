import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class AuthService implements OnModuleDestroy {
    private accessToken: string | null = null;
    private expiresAt: number = 0;
    private readonly logger: LoggerService;
    private readonly keycloakBaseUrl: string;
    private readonly realm: string;
    private readonly clientId: string;
    private readonly clientSecret: string;
    private readonly tokenRequest: string;
    private tokenRefreshInterval: NodeJS.Timeout | null = null;

    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(HttpService) private readonly httpService: HttpService,
        @Inject(LoggerFactory) loggerFactory: LoggerFactory,
    ) {
        // Support both KEYCLOAK_URL and KEYCLOAK_BASE_URL for compatibility
        this.keycloakBaseUrl = this.configService.get('KEYCLOAK_BASE_URL') 
            || this.configService.get('KEYCLOAK_URL') 
            || 'http://keycloak.keycloak.svc.cluster.local/keycloak';  // Fixed: added /keycloak path
        this.realm = this.configService.get('KEYCLOAK_REALM') || 'datamigrator';
        this.clientId = this.configService.get('KEYCLOAK_CLIENT_ID') || 'admin-cli';
        this.clientSecret = this.configService.get('KEYCLOAK_CLIENT_SECRET');
        
        const tokenData = new URLSearchParams();
        tokenData.append('client_id', this.clientId);
        tokenData.append('client_secret', this.clientSecret);
        tokenData.append('grant_type', 'client_credentials');
        this.tokenRequest = tokenData.toString();
        
        this.logger = loggerFactory.create(AuthService.name);
        
        // Log the endpoint being used (helpful for debugging)
        this.logger.log(`[AuthService]: Keycloak endpoint: ${this.keycloakBaseUrl}/realms/${this.realm}/protocol/openid-connect/token`);
    }

    onModuleDestroy() {
        // Clean up refresh timer on module destroy
        if (this.tokenRefreshInterval) {
            clearTimeout(this.tokenRefreshInterval);
            this.tokenRefreshInterval = null;
        }
    }

    async getAccessToken(force: boolean = false): Promise<string | null> {
        const now = Math.floor(Date.now() / 1000);
        
        this.logger.log(`[AuthService]: getAccessToken called - force=${force}, hasToken=${!!this.accessToken}, now=${now}, expiresAt=${this.expiresAt}, isValid=${now < this.expiresAt}`);
        
        // Return cached token if still valid (buffer already applied during storage)
        if (!force && this.accessToken && now < this.expiresAt) {
            this.logger.log(`[AuthService]: Returning cached token (expires in ${this.expiresAt - now}s)`);
            return this.accessToken;
        }
        
        this.logger.log(`[AuthService]: Fetching new token from Keycloak...`);
        
        try {
            const response = await lastValueFrom(
                this.httpService.post(
                    `${this.keycloakBaseUrl}/realms/${this.realm}/protocol/openid-connect/token`,
                    this.tokenRequest,
                    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
                )
            );
            
            const tokenData = response.data as { access_token: string; expires_in: number };
            this.accessToken = tokenData.access_token;
            this.expiresAt = now + tokenData.expires_in - 10;
            this.logger.log(`[AuthService]: Fetched new access token, expires at: ${this.expiresAt} (in ${tokenData.expires_in}s)`);
            
            // Schedule token refresh before expiry
            this.scheduleTokenRefresh(tokenData.expires_in);
            
            return this.accessToken;
        } catch (error) {
            this.logger.error(`[AuthService]: Failed to obtain access token: ${error.message}, stack: ${error.stack}`);
            return null;
        }
    }

    /**
     * Schedule automatic token refresh before expiration
     * Refresh at 23 hours (before 24-hour Keycloak token expiry)
     */
    private scheduleTokenRefresh(expiresIn: number): void {
        // Clear existing refresh timer
        if (this.tokenRefreshInterval) {
            clearTimeout(this.tokenRefreshInterval);
        }

        // Hardcode 23 hours refresh interval (1 hour before 24-hour token expiry)
        const tokenRefreshMinutes = 1380; // 23 hours
        const refreshTime = tokenRefreshMinutes * 60 * 1000;
        
        this.logger.log(`[AuthService]: Scheduling token refresh in ${refreshTime / 1000}s (${tokenRefreshMinutes / 60} hours)`);
        
        this.tokenRefreshInterval = setTimeout(async () => {
            this.logger.log('[AuthService]: Auto-refreshing JWT token...');
            try {
                await this.getAccessToken(true);
            } catch (error) {
                this.logger.error(`[AuthService]: Failed to auto-refresh token: ${error.message}`);
                // Retry in 30 seconds
                setTimeout(() => this.getAccessToken(true), 30000);
            }
        }, refreshTime);
    }
}
