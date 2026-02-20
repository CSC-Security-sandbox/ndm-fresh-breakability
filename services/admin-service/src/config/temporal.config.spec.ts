import temporalConfig from './temporal.config';

describe('temporalConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should use TEMPORAL_ADDRESS from environment', () => {
    process.env.TEMPORAL_ADDRESS = 'temporal.prod:7233';
    const config = temporalConfig();
    expect(config.address).toBe('temporal.prod:7233');
  });

  it('should default to localhost:7233 when TEMPORAL_ADDRESS is not set', () => {
    delete process.env.TEMPORAL_ADDRESS;
    const config = temporalConfig();
    expect(config.address).toBe('localhost:7233');
  });
});
