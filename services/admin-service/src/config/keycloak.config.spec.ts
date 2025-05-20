import keycloakAdminConfig, { KeycloakAdminConfig } from './keycloak.config';

describe('Keycloak Admin Configuration', () => {
  beforeEach(() => {
    process.env.KEYCLOAK_BASE_URL = '';
    process.env.KEYCLOAK_REALM = '';
    process.env.KEYCLOAK_ADMIN_CLIENT = '';
    process.env.KEYCLOAK_ADMIN_USERNAME = '';
    process.env.KEYCLOAK_ADMIN_PASSWORD = '';
  });

  it('should return default config when environment variables are not set', () => {
    const config: KeycloakAdminConfig = keycloakAdminConfig();

    expect(config.keycloakUrl).toBe('http://localhost:8080');
    expect(config.keycloakRealm).toBe('netapp');
    expect(config.keycloakAdminClient).toBe('admin');
    expect(config.keycloakAdminUsername).toBe('admin');
    expect(config.keycloakAdminPassword).toBe('admin');
  });

  it('should return custom config when environment variables are set', () => {
    process.env.KEYCLOAK_BASE_URL = 'https://keycloak.example.com';
    process.env.KEYCLOAK_REALM = 'myrealm';
    process.env.KEYCLOAK_ADMIN_CLIENT = 'custom-admin-client';
    process.env.KEYCLOAK_ADMIN_USERNAME = 'custom-admin-username';
    process.env.KEYCLOAK_ADMIN_PASSWORD = 'custom-admin-password';

    const config: KeycloakAdminConfig = keycloakAdminConfig();

    expect(config.keycloakUrl).toBe('https://keycloak.example.com');
    expect(config.keycloakRealm).toBe('myrealm');
    expect(config.keycloakAdminClient).toBe('custom-admin-client');
    expect(config.keycloakAdminUsername).toBe('custom-admin-username');
    expect(config.keycloakAdminPassword).toBe('custom-admin-password');
  });

  it('should use default values if some environment variables are missing', () => {
    process.env.KEYCLOAK_BASE_URL = 'https://keycloak.example.com';
    process.env.KEYCLOAK_REALM = '';
    process.env.KEYCLOAK_ADMIN_CLIENT = '';
    process.env.KEYCLOAK_ADMIN_USERNAME = 'custom-admin-username';

    const config: KeycloakAdminConfig = keycloakAdminConfig();

    expect(config.keycloakUrl).toBe('https://keycloak.example.com');
    expect(config.keycloakRealm).toBe('netapp'); // Default value
    expect(config.keycloakAdminClient).toBe('admin'); // Default value
    expect(config.keycloakAdminUsername).toBe('custom-admin-username');
    expect(config.keycloakAdminPassword).toBe('admin'); // Default value
  });
});
