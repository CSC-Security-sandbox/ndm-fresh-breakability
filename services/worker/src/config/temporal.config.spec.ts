import temporalConfig from './temporal.config'

describe('Temporal Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const clearEnvVars = () => {
    delete process.env.TEMPORAL_ADDRESS;
  };

  it('should return default values when no environment variables are set', () => {
    clearEnvVars();
    const config = temporalConfig();
    expect(config).toEqual({
      address: 'localhost:7233',
    });
  });

  it('should use the environment variable if it is set', () => {
    process.env.TEMPORAL_ADDRESS = 'temporal.example.com:7233';
    const config = temporalConfig();
    expect(config).toEqual({
      address: 'temporal.example.com:7233',
    });
  });
});

