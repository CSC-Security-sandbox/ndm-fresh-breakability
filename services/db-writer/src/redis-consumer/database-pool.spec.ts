import { DatabasePool } from './database-pool';
import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';

// Mock TypeORM DataSource
const mockDataSource = {
    initialize: jest.fn(),
    destroy: jest.fn(),
    isInitialized: false,
};

// Mock NestJS Logger
const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
};

// Mock @nestjs/swagger to prevent import errors
jest.mock('@nestjs/swagger', () => ({
    ApiProperty: () => (target: any, key: string) => {},
    ApiResponse: () => (target: any, key: string, descriptor: PropertyDescriptor) => {},
    ApiTags: () => (target: any) => {},
    ApiExcludeController: () => (target: any) => {},
    ApiBody: () => (target: any, key: string, descriptor: PropertyDescriptor) => {},
    ApiQuery: () => (target: any, key: string, descriptor: PropertyDescriptor) => {},
}));

// Mock TypeORM decorators and classes
jest.mock('typeorm', () => ({
    DataSource: jest.fn().mockImplementation(() => mockDataSource),
    Entity: () => (target: any) => {},
    Column: () => (target: any, key: string) => {},
    PrimaryGeneratedColumn: () => (target: any, key: string) => {},
    CreateDateColumn: () => (target: any, key: string) => {},
    UpdateDateColumn: () => (target: any, key: string) => {},
    Index: () => (target: any, key?: string) => {},
    Unique: () => (target: any, key?: string) => {},
    ManyToOne: () => (target: any, key: string) => {},
    JoinColumn: () => (target: any, key: string) => {},
    OneToMany: () => (target: any, key: string) => {},
}));

jest.mock('@nestjs/common', () => ({
    Logger: jest.fn().mockImplementation(() => mockLogger),
}));

// Mock entity classes
jest.mock('../entities/inventory.entity', () => ({
    InventoryEntity: class MockInventoryEntity {},
}));

jest.mock('../entities/task.entity', () => ({
    TaskEntity: class MockTaskEntity {},
}));

jest.mock('../entities/operation.entity', () => ({
    OperationsEntity: class MockOperationsEntity {},
}));

jest.mock('../entities/task-error.entity', () => ({
    TaskErrorEntity: class MockTaskErrorEntity {},
}));

jest.mock('../entities/operation-error.entity', () => ({
    OperationErrorEntity: class MockOperationErrorEntity {},
}));

jest.mock('../entities/speed-test.entity', () => ({
    SpeedLogEntity: class MockSpeedLogEntity {},
    SpeedLogEntryEntity: class MockSpeedLogEntryEntity {},
}));

describe('DatabasePool', () => {
    let databasePool: DatabasePool;

    beforeEach(() => {
        // Clear singleton instance before each test
        (DatabasePool as any).instance = null;
        
        // Reset environment variables
        process.env.DB_HOST = 'localhost';
        process.env.DB_PORT = '5432';
        process.env.DB_USER = 'testuser';
        process.env.DB_PASSWORD = 'testpass';
        process.env.DB_NAME = 'testdb';
        process.env.DB_SCHEMA = 'testschema';

        // Reset mocks
        mockDataSource.initialize.mockClear();
        mockDataSource.destroy.mockClear();
        mockDataSource.isInitialized = false;
        mockLogger.log.mockClear();
        mockLogger.error.mockClear();
        mockLogger.warn.mockClear();

        databasePool = DatabasePool.getInstance();
    });

    afterEach(() => {
        jest.clearAllMocks();
        // Clear singleton for clean state
        (DatabasePool as any).instance = null;
    });

    describe('Singleton Pattern', () => {
        it('should return the same instance when getInstance is called multiple times', () => {
            const instance1 = DatabasePool.getInstance();
            const instance2 = DatabasePool.getInstance();
            const instance3 = DatabasePool.getInstance();

            expect(instance1).toBe(instance2);
            expect(instance2).toBe(instance3);
            expect(instance1).toBe(instance3);
        });

        it('should create only one instance even with concurrent calls', async () => {
            // Clear the instance first
            (DatabasePool as any).instance = null;

            const promises = Array.from({ length: 10 }, () => 
                Promise.resolve(DatabasePool.getInstance())
            );

            const instances = await Promise.all(promises);
            const firstInstance = instances[0];

            instances.forEach(instance => {
                expect(instance).toBe(firstInstance);
            });
        });
    });

    describe('getConnection()', () => {
        it('should create and return a connection when none exists', async () => {
            mockDataSource.initialize.mockResolvedValue(undefined);
            mockDataSource.isInitialized = true;
            
            const connection = await databasePool.getConnection();

            expect(mockDataSource.initialize).toHaveBeenCalledTimes(1);
            expect(connection).toBe(mockDataSource);
            expect(mockLogger.log).toHaveBeenCalledWith('🔄 Creating new database connection pool...');
            expect(mockLogger.log).toHaveBeenCalledWith('✅ Database connection pool initialized successfully');
            expect(mockLogger.log).toHaveBeenCalledWith('📊 Database connection acquired. Active connections: 1');
        });

        it('should return existing connection when already initialized', async () => {
            // Set up existing initialized connection
            (databasePool as any).dataSource = mockDataSource;
            mockDataSource.isInitialized = true;

            const connection = await databasePool.getConnection();

            expect(mockDataSource.initialize).not.toHaveBeenCalled();
            expect(connection).toBe(mockDataSource);
            expect(mockLogger.log).toHaveBeenCalledWith('📊 Database connection acquired. Active connections: 1');
        });

        it('should increment connection count with multiple calls', async () => {
            mockDataSource.isInitialized = true;

            await databasePool.getConnection();
            await databasePool.getConnection();
            await databasePool.getConnection();

            expect(databasePool.getActiveConnections()).toBe(3);
            expect(mockLogger.log).toHaveBeenCalledWith('📊 Database connection acquired. Active connections: 1');
            expect(mockLogger.log).toHaveBeenCalledWith('📊 Database connection acquired. Active connections: 2');
            expect(mockLogger.log).toHaveBeenCalledWith('📊 Database connection acquired. Active connections: 3');
        });

        it('should reinitialize connection if dataSource exists but is not initialized', async () => {
            (databasePool as any).dataSource = mockDataSource;
            mockDataSource.isInitialized = false;
            mockDataSource.initialize.mockResolvedValue(undefined);

            const connection = await databasePool.getConnection();

            expect(mockDataSource.initialize).toHaveBeenCalledTimes(1);
            expect(connection).toBe(mockDataSource);
        });

        it('should handle connection creation with custom environment variables', async () => {
            process.env.DB_HOST = 'custom-host';
            process.env.DB_PORT = '3306';
            process.env.DB_USER = 'custom-user';
            process.env.DB_PASSWORD = 'custom-pass';
            process.env.DB_NAME = 'custom-db';
            process.env.DB_SCHEMA = 'custom-schema';

            mockDataSource.isInitialized = true;
            mockDataSource.initialize.mockResolvedValue(undefined);

            await databasePool.getConnection();

            expect(DataSource).toHaveBeenCalledWith(expect.objectContaining({
                type: 'postgres',
                host: 'custom-host',
                port: 3306,
                username: 'custom-user',
                password: 'custom-pass',
                database: 'custom-db',
                schema: 'custom-schema',
                poolSize: 10,
            }));
        });

        it('should use default port when DB_PORT is not provided', async () => {
            delete process.env.DB_PORT;
            mockDataSource.isInitialized = true;
            mockDataSource.initialize.mockResolvedValue(undefined);

            await databasePool.getConnection();

            expect(DataSource).toHaveBeenCalledWith(expect.objectContaining({
                port: 5432,
            }));
        });

        it('should handle connection errors during initialization', async () => {
            const initError = new Error('Database connection failed');
            mockDataSource.initialize.mockRejectedValue(initError);

            await expect(databasePool.getConnection()).rejects.toThrow('Database connection failed');
            expect(mockDataSource.initialize).toHaveBeenCalledTimes(1);
        });
    });

    describe('releaseConnection()', () => {
        it('should decrement connection count when releasing connection', async () => {
            mockDataSource.isInitialized = true;
            mockDataSource.initialize.mockResolvedValue(undefined);
            
            await databasePool.getConnection();
            await databasePool.getConnection();
            expect(databasePool.getActiveConnections()).toBe(2);

            await databasePool.releaseConnection();
            expect(databasePool.getActiveConnections()).toBe(1);
            expect(mockLogger.log).toHaveBeenCalledWith('📊 Database connection released. Active connections: 1');

            await databasePool.releaseConnection();
            expect(databasePool.getActiveConnections()).toBe(0);
            expect(mockLogger.log).toHaveBeenCalledWith('📊 Database connection released. Active connections: 0');
        });

        it('should not decrement below zero when releasing more connections than acquired', async () => {
            await databasePool.releaseConnection();
            await databasePool.releaseConnection();
            
            expect(databasePool.getActiveConnections()).toBe(0);
        });

        it('should close pool when connection count reaches zero', async () => {
            mockDataSource.isInitialized = true;
            mockDataSource.initialize.mockResolvedValue(undefined);
            mockDataSource.destroy.mockResolvedValue(undefined);
            (databasePool as any).dataSource = mockDataSource;

            await databasePool.getConnection();
            await databasePool.releaseConnection();

            expect(mockDataSource.destroy).toHaveBeenCalledTimes(1);
            expect(mockLogger.log).toHaveBeenCalledWith('🔄 Closing database connection pool...');
            expect(mockLogger.log).toHaveBeenCalledWith('✅ Database connection pool closed');
        });

        it('should not close pool if there are still active connections', async () => {
            mockDataSource.isInitialized = true;
            mockDataSource.initialize.mockResolvedValue(undefined);
            (databasePool as any).dataSource = mockDataSource;

            await databasePool.getConnection();
            await databasePool.getConnection();
            await databasePool.releaseConnection();

            expect(databasePool.getActiveConnections()).toBe(1);
            expect(mockDataSource.destroy).not.toHaveBeenCalled();
        });

       describe('forceClose()', () => {
           

           it('should work even when no connections exist', async () => {
               await databasePool.forceClose();

               expect(databasePool.getActiveConnections()).toBe(0);
               expect(mockDataSource.destroy).not.toHaveBeenCalled();
           });
       });
    });

    describe('getActiveConnections()', () => {
        it('should return correct number of active connections', async () => {
            expect(databasePool.getActiveConnections()).toBe(0);

            mockDataSource.isInitialized = true;
            mockDataSource.initialize.mockResolvedValue(undefined);
            await databasePool.getConnection();
            expect(databasePool.getActiveConnections()).toBe(1);

            await databasePool.getConnection();
            await databasePool.getConnection();
            expect(databasePool.getActiveConnections()).toBe(3);

            await databasePool.releaseConnection();
            expect(databasePool.getActiveConnections()).toBe(2);
        });

        it('should maintain accurate count during concurrent operations', async () => {
            mockDataSource.isInitialized = true;
            mockDataSource.initialize.mockResolvedValue(undefined);

            const getPromises = Array.from({ length: 5 }, () => databasePool.getConnection());
            await Promise.all(getPromises);
            
            expect(databasePool.getActiveConnections()).toBe(5);

            const releasePromises = Array.from({ length: 3 }, () => databasePool.releaseConnection());
            await Promise.all(releasePromises);
            
            expect(databasePool.getActiveConnections()).toBe(2);
        });
    });

    describe('isInitialized()', () => {
        it('should return false when no dataSource exists', () => {
            expect(databasePool.isInitialized()).toBe(false);
        });

        it('should return false when dataSource exists but is not initialized', () => {
            (databasePool as any).dataSource = mockDataSource;
            mockDataSource.isInitialized = false;

            expect(databasePool.isInitialized()).toBe(false);
        });

        it('should return true when dataSource is initialized', () => {
            (databasePool as any).dataSource = mockDataSource;
            mockDataSource.isInitialized = true;

            expect(databasePool.isInitialized()).toBe(true);
        });

        it('should return false when dataSource is null', () => {
            (databasePool as any).dataSource = null;

            expect(databasePool.isInitialized()).toBe(false);
        });
    });

    describe('DataSource Configuration', () => {
        it('should configure DataSource with correct entity classes', async () => {
            mockDataSource.isInitialized = true;
            mockDataSource.initialize.mockResolvedValue(undefined);
            await databasePool.getConnection();

            expect(DataSource).toHaveBeenCalledWith(expect.objectContaining({
                entities: expect.arrayContaining([
                    expect.any(Function), // InventoryEntity
                    expect.any(Function), // TaskEntity
                    expect.any(Function), // OperationsEntity
                    expect.any(Function), // TaskErrorEntity
                    expect.any(Function), // OperationErrorEntity
                    expect.any(Function), // SpeedLogEntryEntity
                    expect.any(Function), // SpeedLogEntity
                ]),
            }));
        });

        it('should configure DataSource with correct pool settings', async () => {
            mockDataSource.isInitialized = true;
            mockDataSource.initialize.mockResolvedValue(undefined);
            await databasePool.getConnection();

            expect(DataSource).toHaveBeenCalledWith(expect.objectContaining({
                type: 'postgres',
                synchronize: false,
                dropSchema: false,
                ssl: false,
                logging: false,
                poolSize: 10,
                connectTimeoutMS: 60000,
                extra: expect.objectContaining({
                    max: 10,
                    min: 2,
                    acquireTimeoutMillis: 60000,
                    createTimeoutMillis: 30000,
                    destroyTimeoutMillis: 5000,
                    idleTimeoutMillis: 30000,
                    reapIntervalMillis: 1000,
                }),
            }));
        });
    });

    describe('Error Handling', () => {
        it('should handle createConnection errors gracefully', async () => {
            const connectionError = new Error('Connection failed');
            mockDataSource.initialize.mockRejectedValue(connectionError);

            await expect(databasePool.getConnection()).rejects.toThrow('Connection failed');
            expect(mockDataSource.initialize).toHaveBeenCalledTimes(1);
        });

        it('should handle missing environment variables', async () => {
            delete process.env.DB_HOST;
            delete process.env.DB_USER;
            delete process.env.DB_PASSWORD;
            delete process.env.DB_NAME;
            delete process.env.DB_SCHEMA;

            mockDataSource.isInitialized = true;
            mockDataSource.initialize.mockResolvedValue(undefined);
            await databasePool.getConnection();

            expect(DataSource).toHaveBeenCalledWith(expect.objectContaining({
                host: undefined,
                username: undefined,
                password: undefined,
                database: undefined,
                schema: undefined,
            }));
        });
    });

    describe('Concurrent Operations', () => {
        it('should handle concurrent getConnection calls', async () => {
            mockDataSource.isInitialized = true;
            mockDataSource.initialize.mockResolvedValue(undefined);
            
            const promises = Array.from({ length: 10 }, () => databasePool.getConnection());
            const connections = await Promise.all(promises);

            expect(connections.length).toBe(10);
            connections.forEach(connection => {
                expect(connection).toBe(mockDataSource);
            });
            expect(databasePool.getActiveConnections()).toBe(10);
        });

        it('should handle concurrent releaseConnection calls', async () => {
            mockDataSource.isInitialized = true;
            mockDataSource.initialize.mockResolvedValue(undefined);
            
            // Get connections first
            const getPromises = Array.from({ length: 5 }, () => databasePool.getConnection());
            await Promise.all(getPromises);
            expect(databasePool.getActiveConnections()).toBe(5);

            // Release connections concurrently
            const releasePromises = Array.from({ length: 5 }, () => databasePool.releaseConnection());
            await Promise.all(releasePromises);
            
            expect(databasePool.getActiveConnections()).toBe(0);
        });

        it('should handle mixed concurrent operations', async () => {
            mockDataSource.isInitialized = true;
            mockDataSource.initialize.mockResolvedValue(undefined);
            
            const operations = [
                ...Array.from({ length: 3 }, () => databasePool.getConnection()),
                ...Array.from({ length: 2 }, () => databasePool.releaseConnection()),
                ...Array.from({ length: 2 }, () => databasePool.getConnection()),
            ];

            await Promise.all(operations);
            
            // 3 gets + 2 gets - 2 releases = 3 active connections
            expect(databasePool.getActiveConnections()).toBe(3);
        });
    });

    describe('Memory Management', () => {
        it('should properly clean up resources when closing pool', async () => {
            mockDataSource.isInitialized = true;
            mockDataSource.initialize.mockResolvedValue(undefined);
            mockDataSource.destroy.mockResolvedValue(undefined);
            (databasePool as any).dataSource = mockDataSource;

            await databasePool.getConnection();
            await databasePool.releaseConnection();

            expect((databasePool as any).dataSource).toBeNull();
            expect(mockDataSource.destroy).toHaveBeenCalledTimes(1);
        });

        it('should handle multiple force close calls', async () => {
            mockDataSource.isInitialized = true;
            mockDataSource.initialize.mockResolvedValue(undefined);
            mockDataSource.destroy.mockResolvedValue(undefined);
            
            await databasePool.getConnection();
            await databasePool.forceClose();
            await databasePool.forceClose(); // Second call should not cause issues

            expect(databasePool.getActiveConnections()).toBe(0);
            expect(mockDataSource.destroy).toHaveBeenCalledTimes(1);
        });
    });

    describe('Connection Pool Lifecycle', () => {
        it('should initialize connection pool with correct configuration', async () => {
            mockDataSource.initialize.mockResolvedValue(undefined);
            mockDataSource.isInitialized = true;

            await databasePool.getConnection();

            expect(DataSource).toHaveBeenCalledWith(expect.objectContaining({
                type: 'postgres',
                poolSize: 10,
                connectTimeoutMS: 60000,
                extra: expect.objectContaining({
                    max: 10,
                    min: 2,
                    acquireTimeoutMillis: 60000,
                    createTimeoutMillis: 30000,
                    destroyTimeoutMillis: 5000,
                    idleTimeoutMillis: 30000,
                    reapIntervalMillis: 1000,
                }),
            }));
        });

        it('should handle pool initialization failure', async () => {
            const poolError = new Error('Pool initialization failed');
            mockDataSource.initialize.mockRejectedValue(poolError);

            await expect(databasePool.getConnection()).rejects.toThrow('Pool initialization failed');
        });

        // it('should not recreate pool if already initialized', async () => {
        //     mockDataSource.isInitialized = true;
        //     (databasePool as any).dataSource = mockDataSource;

        //     await databasePool.getConnection();
        //     await databasePool.getConnection();

        //     expect(mockDataSource.initialize).not.toHaveBeenCalled();
        //     expect(DataSource).toHaveBeenCalledTimes(1); // Only called during setup
        // });
    });
});
