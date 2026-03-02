import { HttpService } from '@nestjs/axios';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import { KeycloakConfig } from 'src/config/keycloak.config';
import {
    LoggerFactory,
    LoggerService,
  } from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class AuthService {

    readonly keycloakConfig: KeycloakConfig;
    readonly tokenRequest: string;
    private accessToken: string | null = null;
    private expiresAt: number = 0; 
    readonly workerId: string;
    private readonly logger: LoggerService;

    constructor(
        @Inject(ConfigService) private readonly configService: ConfigService,
        @Inject(HttpService) private readonly httpService: HttpService,
        @Inject (LoggerFactory) loggerFactory: LoggerFactory,
    ) {
        this.workerId = this.configService.get('worker.workerId');
        this.keycloakConfig = this.configService.get<KeycloakConfig>('keycloak');
        const tokenData = new URLSearchParams();
        tokenData.append('client_id', this.workerId);
        tokenData.append('client_secret', this.keycloakConfig.workerSecret);
        tokenData.append('grant_type', 'client_credentials')
        this.tokenRequest = tokenData.toString()
        this.logger = loggerFactory.create(AuthService.name);
    }
    
    async getAccessToken(force: boolean = false): Promise<string | null> {
        const now = Math.floor(Date.now() / 1000); 
        if (this.accessToken && now < this.expiresAt && !force) 
            return this.accessToken;
        try {
            const response = await lastValueFrom(
                this.httpService.post(
                    `${this.keycloakConfig.baseUrl}/realms/${this.keycloakConfig.realm}/protocol/openid-connect/token`,
                    this.tokenRequest,
                    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
                )
            );
            this.accessToken = response.data.access_token;
            this.expiresAt = now + response.data.expires_in - 10; 
            this.logger.log(`Fetched new access token, expires at: ${this.expiresAt}`);
            return this.accessToken;
        } catch (error) {
            this.logger.error(`Failed to obtain access token: ${error.message}`);
            return null;
        }
    }
}
