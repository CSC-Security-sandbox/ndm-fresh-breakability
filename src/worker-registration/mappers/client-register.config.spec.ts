import { ClientConfig } from "./client-register.config";


jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mocked-uuid'),
}));

describe('ClientConfig', () => {
  let config: ClientConfig;

  beforeEach(() => {
    config = new ClientConfig('project-id');
  });

  it('should generate a clientId and secret using uuidv4', () => {
    expect(config.clientId).toBe('mocked-uuid');
    expect(config.secret).toBe('mocked-uuid');
  });

  it('should set the clientId if provided', () => {
    config.setClientId('new-client-id');
    expect(config.clientId).toBe('new-client-id');
  });

  it('should throw an error when setting an empty clientId', () => {
    expect(() => config.setClientId('')).toThrowError('Client ID cannot be empty');
  });

  it('should set the secret if provided', () => {
    config.setSecret('new-secret');
    expect(config.secret).toBe('new-secret');
  });

  it('should throw an error when setting an empty secret', () => {
    expect(() => config.setSecret('')).toThrowError('Secret cannot be empty');
  });

  it('should set the name if provided', () => {
    config.setName('new-name');
    expect(config.name).toBe('new-name');
  });

  it('should set the projectId in protocol mappers', () => {
    config.setProjectId('new-project-id');
    expect(config.protocolMappers[0].config['claim.value']).toBe('project-id');
  });

  it('should return the full config when getConfig is called', () => {
    const configObj = config.getConfig();
    expect(configObj).toHaveProperty('clientId', 'mocked-uuid');
    expect(configObj).toHaveProperty('secret', 'mocked-uuid');
  });
});
