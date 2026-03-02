import {
  Injectable,
  Inject,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import axios from 'axios';
import { readFile } from 'fs/promises';
import { request } from 'https';
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
import { HTTPMethod } from 'src/constants/custom-response-message';

@Injectable()
export class WorkerRegistrationService {
    private readonly logger: LoggerService;

    readonly keycloak: KeycloakAdminConfig;
    readonly workerRegisterConfig: WorkerRegisterConfig;
    private static readonly K8S_API_TIMEOUT_MS = 5000;
    
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
                {headers: {'Content-Type': 'application/x-www-form-urlencoded'}},
            );
            return response.data.access_token;
        } catch (error) {
            this.logger.error('Failed to fetch admin access token', error);
            throw new InternalServerErrorException('Could not authenticate admin');
        }
    }

    private async getGatewayCACertificate(): Promise<string | null> {
        try {
            const secretName = process.env.ISTIO_GATEWAY_TLS_SECRET || 'datamigrator-istio-tls';
            const namespace = process.env.ISTIO_NAMESPACE || 'istio-system';

            this.logger.log(`Fetching Gateway TLS certificate from secret: ${secretName} in namespace: ${namespace}`);

            const token = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
            const ca = await readFile('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt', 'utf8');

            const certificate = await this.fetchSecretFromK8sAPI(secretName, namespace, token, ca);

            if (!certificate) {
                this.logger.warn(`No certificate data found in secret ${secretName}`);
                return null;
            }

            this.logger.log(`Successfully fetched Gateway TLS certificate (${certificate.length} bytes)`);
            return certificate;
        } catch (error) {
            this.logger.error(`Failed to fetch Gateway CA certificate: ${error.message}`, error.stack);
            return null;
        }
    }    

    private fetchSecretFromK8sAPI(
        secretName: string,
        namespace: string,
        token: string,
        ca: string,
    ): Promise<string | null> {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'kubernetes.default.svc',
                port: 443,
                path: `/api/v1/namespaces/${namespace}/secrets/${secretName}`,
                method: HTTPMethod.GET,
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
                ca: ca,
            };

            const req = request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            this.logger.error(`Kubernetes API returned status ${res.statusCode}: ${data}`);
                            resolve(null);
                            return;
                        }

                        const secret = JSON.parse(data);
                        const tlsCert = secret?.data?.['tls.crt'];

                        if (!tlsCert) {
                            this.logger.error('Secret does not contain tls.crt field');
                            resolve(null);
                            return;
                        }

                        resolve(tlsCert);
                    } catch (error) {
                        this.logger.error(`Error parsing Kubernetes API response: ${error.message}`);
                        resolve(null);
                    }
                });
            });

            req.on('error', (error) => {
                this.logger.error(`Error calling Kubernetes API: ${error.message}`);
                reject(error);
            });

            req.setTimeout(WorkerRegistrationService.K8S_API_TIMEOUT_MS, () => {
                req.destroy();
                const error = new Error(`Kubernetes API request timed out after ${WorkerRegistrationService.K8S_API_TIMEOUT_MS}ms`);
                this.logger.error(error.message);
                reject(error);
            });

            req.end();
        });
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
                }
            );

            if (response.status === 201) {
                const gatewayCACertificate = await this.getGatewayCACertificate();

                return new RegisterWorkerResponseDto(
                    details.projectId,
                    clientConfig.clientId,
                    clientConfig.secret,
                    this.workerRegisterConfig.controlPlaneIp,
                    gatewayCACertificate,
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
