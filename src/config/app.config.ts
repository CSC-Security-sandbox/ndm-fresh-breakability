import { registerAs } from '@nestjs/config';

export default registerAs(
  'worker',
  (): Record<string, any> => ({
    shutdownTimeout: process.env.SHUTDOWN_TIMEOUT || 5000,
    workerShutdownTimeout: process.env.WORKER_SHUTDOWN_TIMEOUT || 5000,
    workerId: process.env.WORKER_ID || '6cf21220-5627-4614-a947-778915dba29f',
    buildId: process.env.BUILD_ID || '1.0.0',
    workerConfigUrl: process.env.WORKER_CONFIG_URL || 'http://localhost:3000/api/v1/workers/configs',
  }),
);