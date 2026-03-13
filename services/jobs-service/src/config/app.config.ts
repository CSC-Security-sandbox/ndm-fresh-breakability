import { registerAs } from '@nestjs/config';

export default registerAs(
  'app',
  (): Record<string, unknown> => ({
    http: {
      host: process.env.APP_HOST || '0.0.0.0',
      port: parseInt(process.env.APP_PORT) || 3000,
    },
    rabbitmq: {
      urls: process.env.RABBITMQ_URL?.split(',') || [],
      queue: process.env.RABBITMQ_QUEUE || '',
      durable: process.env.RABBITMQ_QUEUE_IS_DURABLE || false,
      inventoryQueue: process.env.RABBITMQ_INVENTORY_QUEUE,
    },
    paths: {
      mountBasePath: process.env.MOUNT_BASE_PATH || '/mnt/datamigrate',
      startConsumer: process.env.START_CONSUMER || 'http://localhost:3009',
    },
    email: {
      sendMail: process.env.SEND_EMAIL || 'http://localhost:3001',
      enabled: process.env.EMAIL_ENABLED !== 'false', // Default to true, set EMAIL_ENABLED=false to disable
    },
    worker: {
      healthCheckStatusTimout:
        parseInt(process.env.HEALTHCHECK_STATUS_TIMEOUT_SEC) || 60,
    },
    mount: {
      basePath: process.env.DIR_MOUNT_BASE_PATH || '/mnt',
      idleTimeoutMs: parseInt(
        process.env.MOUNT_IDLE_TIMEOUT_MS || '600000',
        10,
      ),
      timeoutMs: parseInt(process.env.MOUNT_TIMEOUT_MS || '120000', 10),
      unmountTimeoutMs: parseInt(process.env.UNMOUNT_TIMEOUT_MS || '30000', 10),
      backupuid: process.env.MOUNT_BACKUP_UID
        ? parseInt(process.env.MOUNT_BACKUP_UID, 10)
        : 0,
    },
  }),
);
