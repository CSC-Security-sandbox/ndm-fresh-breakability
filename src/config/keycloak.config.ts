import { registerAs } from '@nestjs/config';

export type KeycloakAdminConfig = {
    keycloakUrl: string;
    keycloakRealm: string;
    keycloakAdminClient: string;
    keycloakAdminUsername: string;
    keycloakAdminPassword: string;
  };
  
  export default registerAs(
    'keycloakAdmin',
    (): KeycloakAdminConfig => ({
      keycloakUrl: process.env.KEYCLOAK_BASE_URL || 'http://localhost:8080',
      keycloakRealm: process.env.KEYCLOAK_REALM || 'netapp',
      keycloakAdminClient: process.env.KEYCLOAK_ADMIN_CLIENT || 'admin',
      keycloakAdminUsername: process.env.KEYCLOAK_ADMIN_USERNAME || 'admin',
      keycloakAdminPassword: process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin',
    }),
  );