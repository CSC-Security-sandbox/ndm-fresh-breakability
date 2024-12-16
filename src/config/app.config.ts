import { registerAs } from '@nestjs/config';

export default registerAs(
    'app',
    (): Record<string, any> => ({
        http: {
            host: process.env.APP_HOST || '0.0.0.0',
            port: parseInt(process.env.APP_PORT) || 3000,
        },
        rabbitmq: {
            urls: process.env.RABBITMQ_URLS?.split(',') || [],
            inventoryQueue: process.env.RABBITMQ_INVENTORY_QUEUE,
            reportsQueue:  process.env.RABBITMQ_REPORTS_QUEUE,
        }
    }),
);
