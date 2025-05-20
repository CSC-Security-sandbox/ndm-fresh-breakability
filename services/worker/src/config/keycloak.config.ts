import { ConfigFactory, registerAs } from '@nestjs/config';

export interface KeycloakConfig {
  workerSecret: string;
  baseUrl: string;
  realm: string;
}

export default registerAs<KeycloakConfig>(
  'keycloak',
  (): KeycloakConfig => ({
    workerSecret: process.env.WORKER_SECRET || '',
    baseUrl: process.env.KEYCLOAK_BASE_URL || '',
    realm: process.env.KEYCLOAK_REALM || '',
  }),
);
