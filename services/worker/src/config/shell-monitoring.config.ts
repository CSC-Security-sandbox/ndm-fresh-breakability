import { ConfigObject, registerAs } from '@nestjs/config';

export default registerAs(
    'shellMonitoring',
    (): ConfigObject => ({
        shellMonitoringInterval: parseInt(process.env.SHELL_MONITORING_INTERVAL) || 3000, // 3 seconds
        enableShellMonitoring: process.env.ENABLE_SHELL_MONITORING === undefined
            ? true
            : String(process.env.ENABLE_SHELL_MONITORING).toLowerCase() === 'true',
        poolSize: parseInt(process.env.SHELL_POOL_SIZE) || 10,
        maxQueuePerShell: parseInt(process.env.MAX_QUEUE_PER_SHELL) || 1,
        slowCommandThreshold: parseInt(process.env.SLOW_COMMAND_THRESHOLD) || 5000, // 5 seconds
        runAsAdmin: process.env.RUN_SHELL_AS_ADMIN === undefined
            ? false
            : String(process.env.RUN_SHELL_AS_ADMIN).toLowerCase() === 'true',
    }),
);
