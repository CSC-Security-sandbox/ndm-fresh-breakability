import shellMonitoringConfig from './shell-monitoring.config';

describe('shellMonitoringConfig', () => {
    const ENV = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...ENV };
    });

    afterEach(() => {
        process.env = ENV;
    });

    it('should use default values when env vars are not set', () => {
        delete process.env.SHELL_MONITORING_INTERVAL;
        delete process.env.ENABLE_SHELL_MONITORING;
        delete process.env.SHELL_POOL_SIZE;
        delete process.env.MAX_QUEUE_PER_SHELL;
        delete process.env.SLOW_COMMAND_THRESHOLD;
        delete process.env.RUN_SHELL_AS_ADMIN;

        const config = shellMonitoringConfig();
        expect(config).toEqual({
            shellMonitoringInterval: 3000,
            enableShellMonitoring: true,
            poolSize: 10,
            maxQueuePerShell: 1,
            slowCommandThreshold: 5000,
            runAsAdmin: false,
        });
    });

    it('should handle undefined and empty string for enableShellMonitoring and runAsAdmin', () => {
        process.env.ENABLE_SHELL_MONITORING = undefined;
        process.env.RUN_SHELL_AS_ADMIN = undefined;
        let config = shellMonitoringConfig();
        expect(config.enableShellMonitoring).toBe(true);
        expect(config.runAsAdmin).toBe(false);

        process.env.ENABLE_SHELL_MONITORING = '';
        process.env.RUN_SHELL_AS_ADMIN = '';
        config = shellMonitoringConfig();
        expect(config.enableShellMonitoring).toBe(false);
        expect(config.runAsAdmin).toBe(false);
    });

    it('should parse environment variables correctly', () => {
        process.env.SHELL_MONITORING_INTERVAL = '10000';
        process.env.ENABLE_SHELL_MONITORING = 'false';
        process.env.SHELL_POOL_SIZE = '20';
        process.env.MAX_QUEUE_PER_SHELL = '5';
        process.env.SLOW_COMMAND_THRESHOLD = '15000';
        process.env.RUN_SHELL_AS_ADMIN = 'true';

        const config = shellMonitoringConfig();
        expect(config).toEqual({
            shellMonitoringInterval: 10000,
            enableShellMonitoring: false,
            poolSize: 20,
            maxQueuePerShell: 5,
            slowCommandThreshold: 15000,
            runAsAdmin: true,
        });
    });

    it('should fallback to default for invalid number env vars', () => {
        process.env.SHELL_MONITORING_INTERVAL = 'invalid';
        process.env.SHELL_POOL_SIZE = 'NaN';
        process.env.MAX_QUEUE_PER_SHELL = undefined;
        process.env.SLOW_COMMAND_THRESHOLD = '';

        const config = shellMonitoringConfig();
        expect(config.shellMonitoringInterval).toBe(3000);
        expect(config.poolSize).toBe(10);
        expect(config.maxQueuePerShell).toBe(1);
        expect(config.slowCommandThreshold).toBe(5000);
    });

    it('should handle enableShellMonitoring and runAsAdmin boolean parsing', () => {
        process.env.ENABLE_SHELL_MONITORING = 'true';
        process.env.RUN_SHELL_AS_ADMIN = 'false';
        let config = shellMonitoringConfig();
        expect(config.enableShellMonitoring).toBe(true);
        expect(config.runAsAdmin).toBe(false);

        process.env.ENABLE_SHELL_MONITORING = 'false';
        process.env.RUN_SHELL_AS_ADMIN = 'true';
        config = shellMonitoringConfig();
        expect(config.enableShellMonitoring).toBe(false);
        expect(config.runAsAdmin).toBe(true);
    });
});
