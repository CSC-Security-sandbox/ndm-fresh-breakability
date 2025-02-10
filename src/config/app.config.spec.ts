import appConfig from './app.config';

describe('App Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules(); // Reset module cache to prevent conflicts
    process.env = { ...originalEnv }; // Clone environment variables
  });

  afterEach(() => {
    process.env = originalEnv; // Restore original environment variables
  });

  it('should return default values when no environment variables are set', () => {
    delete process.env.APP_HOST;
    delete process.env.APP_PORT;
    delete process.env.ENABLE_VERSIONS_FETCH;
    delete process.env.ENABLE_PRE_LIST_PATH;

    const config = appConfig();
    expect(config).toEqual({
      http: {
        host: '0.0.0.0',
        port: 3000,
      },
      feature: {
        enableVersionFetch: false,
        enablePreListPath: false,
      },
    });
  });

  it('should use environment variables if they are set', () => {
    process.env.APP_HOST = '127.0.0.1';
    process.env.APP_PORT = '8080';
    process.env.ENABLE_VERSIONS_FETCH = 'true';
    process.env.ENABLE_PRE_LIST_PATH = 'false';

    const config = appConfig();
    expect(config).toEqual({
      http: {
        host: '127.0.0.1',
        port: 8080,
      },
      feature: {
        enableVersionFetch: true,
        enablePreListPath: false,
      },
    });
  });

  it('should correctly parse boolean feature flags', () => {
    process.env.ENABLE_VERSIONS_FETCH = 'false';
    process.env.ENABLE_PRE_LIST_PATH = 'true';

    const config = appConfig();
    expect(config.feature.enableVersionFetch).toBe(false);
    expect(config.feature.enablePreListPath).toBe(true);
  });
});
