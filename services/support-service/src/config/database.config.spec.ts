import typeormConfig from "src/config/database.config";
import { DataSourceOptions } from 'typeorm';

// Mock all TypeORM decorators to prevent import errors
jest.mock('typeorm', () => ({
    ...jest.requireActual('typeorm'),
    Entity: () => (target: any) => target,
    PrimaryGeneratedColumn: () => (target: any, key: string) => { },
    Column: () => (target: any, key: string) => { },
    OneToMany: () => (target: any, key: string) => { },
    ManyToOne: () => (target: any, key: string) => { },
    JoinColumn: () => (target: any, key: string) => { },
    CreateDateColumn: () => (target: any, key: string) => { },
    UpdateDateColumn: () => (target: any, key: string) => { },
    Index: () => (target: any, key?: string) => { },
}));

// Mock entity classes
jest.mock('src/entities/config.entity', () => ({
    ConfigEntity: class MockConfigEntity { },
}));

jest.mock('src/entities/fileserver.entity', () => ({
    FileServerEntity: class MockFileServerEntity { },
}));

jest.mock('src/entities/project.entity', () => ({
    ProjectEntity: class MockProjectEntity { },
}));

jest.mock('src/entities/volume.entity', () => ({
    VolumeEntity: class MockVolumeEntity { },
}));

jest.mock('src/entities/jobconfig.entity', () => ({
    JobConfigEntity: class MockJobConfigEntity { },
}));

jest.mock('src/entities/jobrun.entity', () => ({
    JobRunEntity: class MockJobRunEntity { },
}));

jest.mock('src/entities/operation-error.entity', () => ({
    OperationErrorEntity: class MockOperationErrorEntity { },
}));

jest.mock('src/entities/worker.entity', () => ({
    WorkerEntity: class MockWorkerEntity { },
}));

jest.mock('src/entities/workerjobrun.entity', () => ({
    WorkerJobRunMap: class MockWorkerJobRunMap { },
}));

jest.mock('src/entities/worker-stats.entity', () => ({
    WorkerStatsEntity: class MockWorkerStatsEntity { },
}));

// Type assertion for PostgreSQL DataSourceOptions
type PostgresDataSourceOptions = DataSourceOptions & {
    type: 'postgres';
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    database?: string;
    schema?: string;
    entities?: any[];
    migrations?: any[];
    synchronize?: boolean;
    dropSchema?: boolean;
    logging?: boolean;
};

describe('TypeORM Config', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...OLD_ENV }; // make a copy to modify
    });

    afterEach(() => {
        process.env = OLD_ENV; // restore original env
    });

    it('should return correct configuration when all environment variables are defined', () => {
        process.env.DB_HOST = 'localhost';
        process.env.DB_PORT = '5433';
        process.env.DB_USER = 'user';
        process.env.DB_PASSWORD = 'pass';
        process.env.DB_NAME = 'testdb';
        process.env.SCHEMA = 'public';

        const config = typeormConfig() as PostgresDataSourceOptions;

        expect(config.type).toBe('postgres');
        expect(config.host).toBe('localhost');
        expect(config.port).toBe(5433);
        expect(config.username).toBe('user');
        expect(config.password).toBe('pass');
        expect(config.database).toBe('testdb');
        expect(config.schema).toBe('public');
        expect(config.synchronize).toBe(false);
        expect(config.dropSchema).toBe(false);
        expect(config.logging).toBe(false);
        expect(config.entities).toBeDefined();
        expect(config.entities!.length).toBeGreaterThan(0);
        expect(config.migrations).toEqual([]);
    });

    it('should default DB_PORT to 5432 if not set', () => {
        process.env.DB_HOST = 'localhost';
        delete process.env.DB_PORT;
        process.env.DB_USER = 'user';
        process.env.DB_PASSWORD = 'pass';
        process.env.DB_NAME = 'testdb';
        process.env.SCHEMA = 'myschema';

        const config = typeormConfig() as PostgresDataSourceOptions;

        expect(config.port).toBe(5432); // default
    });

    it('should return undefined schema if process.env.SCHEMA is not set', () => {
        process.env.DB_HOST = 'localhost';
        process.env.DB_PORT = '5432';
        process.env.DB_USER = 'user';
        process.env.DB_PASSWORD = 'pass';
        process.env.DB_NAME = 'testdb';
        delete process.env.SCHEMA;

        const config = typeormConfig() as PostgresDataSourceOptions;

        expect(config.schema).toBeUndefined();
    });

    it('should handle undefined environment variables', () => {
        delete process.env.DB_HOST;
        delete process.env.DB_PORT;
        delete process.env.DB_USER;
        delete process.env.DB_PASSWORD;
        delete process.env.DB_NAME;
        delete process.env.SCHEMA;

        const config = typeormConfig() as PostgresDataSourceOptions;

        expect(config.host).toBeUndefined();
        expect(config.port).toBe(5432); // default
        expect(config.username).toBeUndefined();
        expect(config.password).toBeUndefined();
        expect(config.database).toBeUndefined();
        expect(config.schema).toBeUndefined();
    });

    it('should handle invalid port numbers', () => {
        process.env.DB_PORT = 'invalid_port';

        const config = typeormConfig() as PostgresDataSourceOptions;

        expect(config.port).toBeNaN();
    });

    it('should handle zero port', () => {
        process.env.DB_PORT = '0';

        const config = typeormConfig() as PostgresDataSourceOptions;

        expect(config.port).toBe(0);
    });

    it('should handle negative port', () => {
        process.env.DB_PORT = '-1';

        const config = typeormConfig() as PostgresDataSourceOptions;

        expect(config.port).toBe(-1);
    });

    it('should handle port with whitespace', () => {
        process.env.DB_PORT = '  5433  ';

        const config = typeormConfig() as PostgresDataSourceOptions;

        expect(config.port).toBe(5433);
    });

    it('should have correct static configuration values', () => {
        const config = typeormConfig() as PostgresDataSourceOptions;

        expect(config.type).toBe('postgres');
        expect(config.synchronize).toBe(false);
        expect(config.dropSchema).toBe(false);
        expect(config.logging).toBe(false);
        expect(config.migrations).toEqual([]);
    });

    it('should include all required entities', () => {
        const config = typeormConfig() as PostgresDataSourceOptions;

        expect(config.entities).toBeDefined();
        expect(Array.isArray(config.entities)).toBe(true);
        expect(config.entities!.length).toBe(10);
    });

    it('should have correct namespace key', () => {
        expect(typeormConfig.KEY).toBe('CONFIGURATION(typeorm)');
    });

    it('should return the same configuration when called multiple times', () => {
        process.env.DB_HOST = 'test-host';
        process.env.DB_PORT = '5432';

        const config1 = typeormConfig();
        const config2 = typeormConfig();

        expect(config1).toEqual(config2);
    });

    it('should return new object instances on each call', () => {
        const config1 = typeormConfig();
        const config2 = typeormConfig();

        expect(config1).not.toBe(config2);
    });

    it('should handle special characters in environment variables', () => {
        process.env.DB_HOST = 'host@domain.com';
        process.env.DB_USER = 'user@domain.com';
        process.env.DB_PASSWORD = 'P@ssw0rd!@#$%^&*()';
        process.env.DB_NAME = 'db-name_test';
        process.env.SCHEMA = 'schema_v1';

        const config = typeormConfig() as PostgresDataSourceOptions;

        expect(config.host).toBe('host@domain.com');
        expect(config.username).toBe('user@domain.com');
        expect(config.password).toBe('P@ssw0rd!@#$%^&*()');
        expect(config.database).toBe('db-name_test');
        expect(config.schema).toBe('schema_v1');
    });

    it('should handle large port numbers', () => {
        process.env.DB_PORT = '65535';

        const config = typeormConfig() as PostgresDataSourceOptions;

        expect(config.port).toBe(65535);
    });

    it('should handle boolean-like strings in environment variables', () => {
        process.env.DB_HOST = 'true';
        process.env.DB_USER = 'false';
        process.env.DB_PASSWORD = 'yes';
        process.env.DB_NAME = 'no';
        process.env.SCHEMA = '1';

        const config = typeormConfig() as PostgresDataSourceOptions;

        expect(config.host).toBe('true');
        expect(config.username).toBe('false');
        expect(config.password).toBe('yes');
        expect(config.database).toBe('no');
        expect(config.schema).toBe('1');
    });

    it('should handle number-like strings in environment variables', () => {
        process.env.DB_HOST = '12345';
        process.env.DB_USER = '67890';
        process.env.DB_PASSWORD = '99999';
        process.env.DB_NAME = '11111';
        process.env.SCHEMA = '22222';

        const config = typeormConfig() as PostgresDataSourceOptions;

        expect(config.host).toBe('12345');
        expect(config.username).toBe('67890');
        expect(config.password).toBe('99999');
        expect(config.database).toBe('11111');
        expect(config.schema).toBe('22222');
    });

    it('should handle mixed environment variable scenarios', () => {
        process.env.DB_HOST = 'mixed-host.example.com';
        delete process.env.DB_PORT; // Will use default 5432
        process.env.DB_USER = 'mixed_user';
        delete process.env.DB_PASSWORD; // Will be undefined
        process.env.DB_NAME = 'mixed_database';
        delete process.env.SCHEMA; // Will be undefined

        const config = typeormConfig() as PostgresDataSourceOptions;

        expect(config.host).toBe('mixed-host.example.com');
        expect(config.port).toBe(5432);
        expect(config.username).toBe('mixed_user');
        expect(config.password).toBeUndefined();
        expect(config.database).toBe('mixed_database');
        expect(config.schema).toBeUndefined();
    });
});
