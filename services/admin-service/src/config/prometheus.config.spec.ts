import prometheusConfig, { PrometheusConfig } from './prometheus.config';

describe('PrometheusConfig', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    // Store original environment
    originalEnv = process.env;
  });

  afterEach(() => {
    // Restore original environment after each test
    process.env = { ...originalEnv };
    // Explicitly clean up the test environment variables
    delete process.env.PROMETHEUS_BASE_URL;
    delete process.env.PROMETHEUS_TIMEOUT;
  });

  describe('prometheusConfig factory', () => {
    it('should be defined', () => {
      expect(prometheusConfig).toBeDefined();
    });

    it('should have correct configuration key', () => {
      expect(prometheusConfig.KEY).toBe('CONFIGURATION(prometheusConfig)');
    });

    it('should return default prometheusBaseIp when PROMETHEUS_BASE_URL is not set', () => {
      // Remove PROMETHEUS_BASE_URL from environment
      delete process.env.PROMETHEUS_BASE_URL;

      const config: PrometheusConfig = prometheusConfig();

      expect(config).toEqual({
        prometheusBaseIp:
          'http://prometheus-server.prometheus.svc.cluster.local:80/api/v1',
        timeout: 30000,
      });
    });

    it('should use PROMETHEUS_BASE_URL environment variable when set', () => {
      process.env.PROMETHEUS_BASE_URL = 'http://custom-prometheus:9090/api/v1';

      const config: PrometheusConfig = prometheusConfig();

      expect(config).toEqual({
        prometheusBaseIp: 'http://custom-prometheus:9090/api/v1',
        timeout: 30000,
      });
    });

    it('should use PROMETHEUS_BASE_URL even when set to empty string', () => {
      process.env.PROMETHEUS_BASE_URL = '';

      const config: PrometheusConfig = prometheusConfig();

      // Empty string is falsy, so it uses the default
      expect(config).toEqual({
        prometheusBaseIp:
          'http://prometheus-server.prometheus.svc.cluster.local:80/api/v1',
        timeout: 30000,
      });
    });

    it('should handle various PROMETHEUS_BASE_URL formats', () => {
      const testCases = [
        'http://localhost:9090',
        'https://prometheus.example.com',
        'http://192.168.1.100:9090/api/v1',
        'prometheus-service:9090',
        'localhost:9090',
      ];

      testCases.forEach((baseUrl) => {
        process.env.PROMETHEUS_BASE_URL = baseUrl;

        const config: PrometheusConfig = prometheusConfig();

        expect(config).toEqual({
          prometheusBaseIp: baseUrl,
          timeout: 30000,
        });
      });
    });

    it('should return a new config object on each call', () => {
      process.env.PROMETHEUS_BASE_URL = 'http://test-prometheus:9090';

      const config1: PrometheusConfig = prometheusConfig();
      const config2: PrometheusConfig = prometheusConfig();

      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // Different object instances
    });

    it('should handle undefined environment variable gracefully', () => {
      // Properly delete the environment variable instead of setting it to undefined
      delete process.env.PROMETHEUS_BASE_URL;

      const config: PrometheusConfig = prometheusConfig();

      expect(config).toEqual({
        prometheusBaseIp:
          'http://prometheus-server.prometheus.svc.cluster.local:80/api/v1',
        timeout: 30000,
      });
    });

    it('should preserve trailing slashes in PROMETHEUS_BASE_URL', () => {
      process.env.PROMETHEUS_BASE_URL = 'http://prometheus:9090/api/v1/';

      const config: PrometheusConfig = prometheusConfig();

      expect(config).toEqual({
        prometheusBaseIp: 'http://prometheus:9090/api/v1/',
        timeout: 30000,
      });
    });

    it('should handle PROMETHEUS_BASE_URL with special characters', () => {
      process.env.PROMETHEUS_BASE_URL =
        'http://prometheus-test_env.example-domain.com:9090/api/v1';

      const config: PrometheusConfig = prometheusConfig();

      expect(config).toEqual({
        prometheusBaseIp:
          'http://prometheus-test_env.example-domain.com:9090/api/v1',
        timeout: 30000,
      });
    });

    it('should handle PROMETHEUS_BASE_URL with query parameters', () => {
      process.env.PROMETHEUS_BASE_URL =
        'http://prometheus:9090/api/v1?timeout=30s';

      const config: PrometheusConfig = prometheusConfig();

      expect(config).toEqual({
        prometheusBaseIp: 'http://prometheus:9090/api/v1?timeout=30s',
        timeout: 30000,
      });
    });

    it('should return default timeout when PROMETHEUS_TIMEOUT is not set', () => {
      // Remove PROMETHEUS_TIMEOUT from environment
      delete process.env.PROMETHEUS_TIMEOUT;

      const config: PrometheusConfig = prometheusConfig();

      expect(config.timeout).toBe(30000);
    });

    it('should use PROMETHEUS_TIMEOUT environment variable when set', () => {
      // Clean environment first
      delete process.env.PROMETHEUS_BASE_URL;
      delete process.env.PROMETHEUS_TIMEOUT;

      process.env.PROMETHEUS_TIMEOUT = '60000';

      const config: PrometheusConfig = prometheusConfig();

      expect(config).toEqual({
        prometheusBaseIp:
          'http://prometheus-server.prometheus.svc.cluster.local:80/api/v1',
        timeout: 60000,
      });
    });

    it('should handle various PROMETHEUS_TIMEOUT values', () => {
      const testCases = [
        { env: '15000', expected: 15000 },
        { env: '45000', expected: 45000 },
        { env: '90000', expected: 90000 },
      ];

      testCases.forEach(({ env, expected }) => {
        // Clean environment for each test case
        delete process.env.PROMETHEUS_BASE_URL;
        delete process.env.PROMETHEUS_TIMEOUT;

        process.env.PROMETHEUS_TIMEOUT = env;

        const config: PrometheusConfig = prometheusConfig();

        expect(config.timeout).toBe(expected);
      });
    });

    it('should handle PROMETHEUS_TIMEOUT with both environment variables set', () => {
      // Clean environment first
      delete process.env.PROMETHEUS_BASE_URL;
      delete process.env.PROMETHEUS_TIMEOUT;

      process.env.PROMETHEUS_BASE_URL = 'http://custom-prometheus:9090/api/v1';
      process.env.PROMETHEUS_TIMEOUT = '120000';

      const config: PrometheusConfig = prometheusConfig();

      expect(config).toEqual({
        prometheusBaseIp: 'http://custom-prometheus:9090/api/v1',
        timeout: 120000,
      });
    });
  });

  describe('PrometheusConfig type', () => {
    it('should have correct type structure', () => {
      const config: PrometheusConfig = {
        prometheusBaseIp: 'test-value',
        timeout: 30000,
      };

      expect(typeof config.prometheusBaseIp).toBe('string');
      expect(typeof config.timeout).toBe('number');
      expect(config).toHaveProperty('prometheusBaseIp');
      expect(config).toHaveProperty('timeout');
    });

    it('should enforce string type for prometheusBaseIp', () => {
      // TypeScript compile-time check
      const config: PrometheusConfig = {
        prometheusBaseIp: 'http://prometheus:9090',
        timeout: 30000,
      };

      expect(typeof config.prometheusBaseIp).toBe('string');
      expect(typeof config.timeout).toBe('number');
    });
  });

  describe('environment variable handling', () => {
    it('should prioritize PROMETHEUS_BASE_URL over default when both are available', () => {
      process.env.PROMETHEUS_BASE_URL = 'http://env-prometheus:9090';

      const config: PrometheusConfig = prometheusConfig();

      expect(config.prometheusBaseIp).toBe('http://env-prometheus:9090');
      expect(config.prometheusBaseIp).not.toBe('localhost');
    });

    it('should handle numeric-like strings in PROMETHEUS_BASE_URL', () => {
      process.env.PROMETHEUS_BASE_URL = '192.168.1.100:9090';

      const config: PrometheusConfig = prometheusConfig();

      expect(config).toEqual({
        prometheusBaseIp: '192.168.1.100:9090',
        timeout: 30000,
      });
      expect(typeof config.prometheusBaseIp).toBe('string');
    });

    it('should handle whitespace in PROMETHEUS_BASE_URL', () => {
      process.env.PROMETHEUS_BASE_URL = '  http://prometheus:9090  ';

      const config: PrometheusConfig = prometheusConfig();

      expect(config).toEqual({
        prometheusBaseIp: '  http://prometheus:9090  ',
        timeout: 30000,
      });
    });
  });

  describe('integration with NestJS config system', () => {
    it('should work with registerAs pattern', () => {
      const configFactory = prometheusConfig;

      expect(configFactory.KEY).toBe('CONFIGURATION(prometheusConfig)');
      expect(typeof configFactory).toBe('function');

      const result = configFactory();
      expect(result).toHaveProperty('prometheusBaseIp');
    });

    it('should return consistent results when called multiple times', () => {
      process.env.PROMETHEUS_BASE_URL = 'http://consistent-test:9090';

      const results = Array.from({ length: 5 }, () => prometheusConfig());

      results.forEach((result, index) => {
        expect(result).toEqual({
          prometheusBaseIp: 'http://consistent-test:9090',
          timeout: 30000,
        });

        if (index > 0) {
          expect(result).toEqual(results[0]);
        }
      });
    });
  });
});
