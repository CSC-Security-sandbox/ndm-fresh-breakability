import appConfig from './app.config';

describe('App Config', () => {
    it('should return default configuration when environment variables are not set', () => {
        process.env.APP_HOST = '';
        process.env.APP_PORT = '';
        const config = appConfig();
        expect(config).toEqual({
            http: { host: '0.0.0.0', port: 3000 },
            rabbitmq: { urls: [], inventoryQueue: undefined ,  reportsQueue:  undefined},
        });
    });

    it('should use environment variables for configuration', () => {
        process.env.APP_HOST = 'localhost';
        process.env.APP_PORT = '8080';
        process.env.RABBITMQ_URLS = 'amqp://localhost,amqp://backup';
        process.env.RABBITMQ_INVENTORY_QUEUE = 'inventory_queue';
        const config = appConfig();
        expect(config).toEqual({
            http: { host: 'localhost', port: 8080 },
            rabbitmq: {
                urls: ['amqp://localhost', 'amqp://backup'],
                inventoryQueue: 'inventory_queue',
            },
        });
    });
});
