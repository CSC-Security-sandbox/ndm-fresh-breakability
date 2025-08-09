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
}
