import { Injectable, InternalServerErrorException, Logger, BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { ClientConfig } from './mappers/client-register.config';
import { RegisterWorkerDto } from './dto/register-worker.dto';
import { ConfigService } from '@nestjs/config';
import { KeycloakAdminConfig } from 'src/config/keycloak.config';

@Injectable()
export class WorkerRegistrationService {
    private readonly logger = new Logger(WorkerRegistrationService.name);
    
    readonly keycloak: KeycloakAdminConfig;

    constructor(private readonly configService: ConfigService) {
        this.keycloak = this.configService.get<KeycloakAdminConfig>('keycloakAdmin');
    }

    async getAdminAccessToken(): Promise<string> {
        try {
            const response = await axios.post(
                `${this.keycloak.keycloakUrl}/realms/master/protocol/openid-connect/token`,
                new URLSearchParams({
                    grant_type: 'password',
                    client_id: this.keycloak.keycloakAdminClient,
                    username: this.keycloak.keycloakAdminUsername,
                    password: this.keycloak.keycloakAdminPassword,
                }),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
            );
            return response.data.access_token;
        } catch (error) {
            this.logger.error('Failed to fetch admin access token', error);
            throw new InternalServerErrorException('Could not authenticate admin');
        }
    }

    async registerWorker(details: RegisterWorkerDto) {
        try {
            if (!details.projectId || !details.workerName) 
                throw new BadRequestException('Invalid worker registration details');
            
            const clientConfig = new ClientConfig(details.projectId, details.workerName).getConfig();
            const accessToken = await this.getAdminAccessToken();
            
            const response = await axios.post(
                `${this.keycloak.keycloakUrl}/admin/realms/${this.keycloak.keycloakRealm}/clients`,
                clientConfig,
                { 
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${accessToken}`
                    } 
                }
            );
            if (response.status === 201) {
                return { workerId: clientConfig.clientId, secret: clientConfig.secret };
            }
            throw new InternalServerErrorException(`Failed to register worker with status code ${response.status}`);
        } catch (error) {
            this.logger.error('Error during worker registration', error);
            if (axios.isAxiosError(error) && error.response) 
                throw new InternalServerErrorException(error.response.data);
            throw new InternalServerErrorException('Unexpected error occurred while registering worker');
        }
    }
}
