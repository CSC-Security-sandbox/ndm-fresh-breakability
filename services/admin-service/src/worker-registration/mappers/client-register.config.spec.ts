import { ClientConfig } from './client-register.config';
import { v4 as uuidv4 } from 'uuid';

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mocked-uuid'),
}));

describe('ClientConfig', () => {
  let config: ClientConfig;

  beforeEach(() => {
    config = new ClientConfig('project-id');
  });

  it('should generate a clientId and secret using uuidv4', () => {
    expect(uuidv4).toHaveBeenCalledTimes(2);
    expect(config.clientId).toBe('mocked-uuid');
    expect(config.secret).toBe('mocked-uuid');
  });

  it('should set the clientId if provided', () => {
    config.setClientId('new-client-id');
    expect(config.clientId).toBe('new-client-id');
  });

  it('should throw an error when setting an empty clientId', () => {
    expect(() => config.setClientId('')).toThrowError(
      'Client ID cannot be empty',
    );
  });

  it('should set the secret if provided', () => {
    config.setSecret('new-secret');
    expect(config.secret).toBe('new-secret');
  });

  it('should throw an error when setting an empty secret', () => {
    expect(() => config.setSecret('')).toThrowError('Secret cannot be empty');
  });

  it('should correctly initialize protocolMappers with projectId', () => {
    expect(config.protocolMappers[0].config['claim.value']).toBe('project-id');
  });

  it('should update the projectId in protocol mappers if mapper exists', () => {
    config.protocolMappers.push({
      name: 'custom-client-claim',
      protocol: 'openid-connect',
      protocolMapper: 'oidc-hardcoded-claim-mapper',
      consentRequired: false,
      config: { 'claim.value': 'old-project-id' },
    });

    config.setProjectId('new-project-id');
    expect(
      config.protocolMappers.find((m) => m.name === 'custom-client-claim')
        ?.config['claim.value'],
    ).toBe('new-project-id');
  });

  it('should do nothing if setProjectId is called but custom-client-claim mapper is missing', () => {
    config.setProjectId('new-project-id');
    expect(
      config.protocolMappers.find((m) => m.name === 'custom-client-claim'),
    ).toBeUndefined();
  });

  it('should return the full config when getConfig is called', () => {
    const configObj = config.getConfig();
    expect(configObj).toHaveProperty('clientId', 'mocked-uuid');
    expect(configObj).toHaveProperty('secret', 'mocked-uuid');
    expect(configObj).toHaveProperty('enabled', true);
    expect(configObj).toHaveProperty('name', `worker-mocked-uuid`);
    expect(configObj).toHaveProperty(
      'clientAuthenticatorType',
      'client-secret',
    );
    expect(configObj).toHaveProperty('fullScopeAllowed', false);
    expect(configObj).toHaveProperty('serviceAccountsEnabled', true);
    expect(configObj.protocolMappers.length).toBeGreaterThan(0);
  });
});
