
import { ConfigFactory } from '@nestjs/config';
import keycloakConfig, { KeycloakConfig } from './keycloak.config';

describe('Keycloak Config', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV }; 
  });

  afterEach(() => {
    process.env = OLD_ENV; 
  });

  it('should return default empty values if no env variables are set', () => {
    delete process.env.WORKER_SECRET;
    delete process.env.KEYCLOAK_BASE_URL;
    delete process.env.KEYCLOAK_REALM;

    const config = (keycloakConfig as ConfigFactory<KeycloakConfig>)();
    expect(config).toEqual({ workerSecret: '', baseUrl: '', realm: '' });
  });

  it('should return the correct values from environment variables', () => {
    process.env.WORKER_SECRET = 'test-secret';
    process.env.KEYCLOAK_BASE_URL = 'http://localhost:8080';
    process.env.KEYCLOAK_REALM = 'test-realm';

    const config = (keycloakConfig as ConfigFactory<KeycloakConfig>)();
    expect(config).toEqual({
      workerSecret: 'test-secret',
      baseUrl: 'http://localhost:8080',
      realm: 'test-realm',
    });
  });
});
