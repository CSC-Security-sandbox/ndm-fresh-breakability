import databaseConfig from './database.config';
import { InventoryEntity } from '../entities/inventory.entity';

describe('Database Config', () => {
    it('should return database configuration', () => {
        process.env.DB_HOST = 'localhost';
        process.env.DB_PORT = '5432';
        process.env.DB_USER = 'user';
        process.env.DB_PASSWORD = 'password';
        process.env.DB_NAME = 'testdb';
        process.env.SCHEMA = 'public';

        const config = databaseConfig();
        expect(config).toEqual({
            type: 'postgres',
            host: 'localhost',
            port: 5432,
            username: 'user',
            password: 'password',
            database: 'testdb',
            schema: 'public',
            synchronize: false,
            dropSchema: false,
            ssl: false,
            logging: false,
            entities: [InventoryEntity],
            migrations: [],
        });
    });
});
