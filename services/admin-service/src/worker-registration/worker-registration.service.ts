import {
  Injectable,
  Inject,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import axios from 'axios';
import { ClientConfig } from './mappers/client-register.config';
import {
  RegisterWorkerDto,
  RegisterWorkerResponseDto,
} from './dto/register-worker.dto';
import { ConfigService } from '@nestjs/config';
import { KeycloakAdminConfig } from 'src/config/keycloak.config';
import { WorkerRegisterConfig } from 'src/config/workerregister.config';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class WorkerRegistrationService {
  private readonly logger: LoggerService;

  readonly keycloak: KeycloakAdminConfig;
  readonly workerRegisterConfig: WorkerRegisterConfig;

  constructor(
    private readonly configService: ConfigService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.keycloak =
      this.configService.get<KeycloakAdminConfig>('keycloakAdmin');
    this.workerRegisterConfig =
      this.configService.get<WorkerRegisterConfig>('workerRegister');
    this.logger = loggerFactory.create(WorkerRegistrationService.name);
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
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      return response.data.access_token;
    } catch (error) {
      this.logger.error('Failed to fetch admin access token', error);
      throw new InternalServerErrorException('Could not authenticate admin');
    }
  }

  async registerWorker(details: RegisterWorkerDto) {
    try {
      if (!details.projectId)
        throw new BadRequestException('Invalid project Id');

      const clientConfig = new ClientConfig(details.projectId).getConfig();
      const accessToken = await this.getAdminAccessToken();

      const response = await axios.post(
        `${this.keycloak.keycloakUrl}/admin/realms/${this.keycloak.keycloakRealm}/clients`,
        clientConfig,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (response.status === 201) {

        
        // Assign standard worker roles to ALL workers
        await this.assignStandardWorkerRoles(clientConfig.clientId, accessToken);

        return new RegisterWorkerResponseDto(
          details.projectId,
          clientConfig.clientId,
          clientConfig.secret,
          this.workerRegisterConfig.controlPlaneIp,
        );
      }
      throw new InternalServerErrorException(
        `Failed to register worker with status code ${response.status}`,
      );
    } catch (error) {
      this.logger.error('Error during worker registration', error);
      if (axios.isAxiosError(error) && error.response)
        throw new InternalServerErrorException(error.response.data);
      throw new InternalServerErrorException(
        'Unexpected error occurred while registering worker',
      );
    }
  }

  // Assign same roles to ALL workers
  private async assignStandardWorkerRoles(clientId: string, adminToken: string): Promise<void> {
    // Standard roles that ALL workers get
    const standardRoles = [
      'redis-secret-reader',  // For Redis credential access
      // Add any other standard roles here
    ];

    try {
      // Get client UUID
      const clientResponse = await axios.get(
        `${this.keycloak.keycloakUrl}/admin/realms/${this.keycloak.keycloakRealm}/clients?clientId=${clientId}`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      
      const clientUuid = clientResponse.data[0]?.id;
      if (!clientUuid) {
        throw new Error(`Client UUID not found for ${clientId}`);
      }

      // Get role assignments
      const roleAssignments = [];
      for (const roleName of standardRoles) {
        try {
          const roleResponse = await axios.get(
            `${this.keycloak.keycloakUrl}/admin/realms/${this.keycloak.keycloakRealm}/roles/${roleName}`,
            { headers: { Authorization: `Bearer ${adminToken}` } }
          );
          
          roleAssignments.push({
            id: roleResponse.data.id,
            name: roleName
          });
        } catch (error) {
          console.warn(`Role ${roleName} not found, skipping...`);
        }
      }

      // Assign roles to worker's service account
      if (roleAssignments.length > 0) {
        await axios.post(
          `${this.keycloak.keycloakUrl}/admin/realms/${this.keycloak.keycloakRealm}/clients/${clientUuid}/service-account/role-mappings/realm`,
          roleAssignments,
          {
            headers: {
              Authorization: `Bearer ${adminToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        console.log(`✅ Assigned standard roles [${standardRoles.join(', ')}] to worker ${clientId}`);
      }

    } catch (error) {
      console.error(`❌ Failed to assign roles to worker ${clientId}:`, error.message);
      // Don't throw - worker creation should succeed even if role assignment fails
      throw error;
    }
  }

}
