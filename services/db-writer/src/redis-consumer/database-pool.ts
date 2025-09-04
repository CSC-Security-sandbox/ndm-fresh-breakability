import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import { InventoryEntity } from '../entities/inventory.entity';
import { TaskEntity } from '../entities/task.entity';
import { OperationsEntity } from '../entities/operation.entity';
import { TaskErrorEntity } from '../entities/task-error.entity';
import { OperationErrorEntity } from '../entities/operation-error.entity';
import { SpeedLogEntity, SpeedLogEntryEntity } from '../entities/speed-test.entity';

export class DatabasePool {
    private static instance: DatabasePool;
    private dataSource: DataSource | null = null;
    private connectionCount = 0;
    private readonly logger = new Logger('DatabasePool');

    private constructor() {}

    static getInstance(): DatabasePool {
        if (!DatabasePool.instance) {
            DatabasePool.instance = new DatabasePool();
        }
        return DatabasePool.instance;
    }

    async getConnection(): Promise<DataSource> {
        if (!this.dataSource || !this.dataSource.isInitialized) {
            await this.createConnection();
        }
        
        this.connectionCount++;
        this.logger.log(`📊 Database connection acquired. Active connections: ${this.connectionCount}`);
        return this.dataSource!;
    }

    async releaseConnection(): Promise<void> {
        if (this.connectionCount > 0) {
            this.connectionCount--;
            this.logger.log(`📊 Database connection released. Active connections: ${this.connectionCount}`);
        }

        // Close the pool when no active connections
        if (this.connectionCount === 0 && this.dataSource?.isInitialized) {
            await this.closePool();
        }
    }

    private async createConnection(): Promise<void> {
        if (this.dataSource?.isInitialized) {
            return;
        }

        this.logger.log('🔄 Creating new database connection pool...');
        
        this.dataSource = new DataSource({
            type: 'postgres',
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT ?? '5432', 10),
            username: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            schema: process.env.DB_SCHEMA,
            synchronize: false,
            dropSchema: false,
            ssl: false,
            logging: false,
            // Connection pool configuration
            poolSize: parseInt(process.env.DB_POOL_SIZE ?? '10', 10), // Maximum number of connections in pool
            connectTimeoutMS: parseInt(process.env.DB_CONNECT_TIMEOUT_MS ?? '60000', 10), // Connection timeout
            entities: [
                InventoryEntity,
                TaskEntity,
                OperationsEntity,
                TaskErrorEntity,
                OperationErrorEntity,
                SpeedLogEntryEntity,
                SpeedLogEntity,
            ],
            migrations: [],
            extra: {
                // PostgreSQL specific pool settings
                max:  parseInt(process.env.DB_POOL_SIZE ?? '50', 10), // Maximum connections
                min: parseInt(process.env.DB_POOL_SIZE_MIN ?? '2', 10),  // Minimum connections
                acquireTimeoutMillis: 60000,
                createTimeoutMillis: 30000,
                destroyTimeoutMillis: 5000,
                idleTimeoutMillis: 30000,
                reapIntervalMillis: 10000,
            }
        });

        await this.dataSource.initialize();
        this.logger.log('✅ Database connection pool initialized successfully');
    }

    private async closePool(): Promise<void> {
        if (this.dataSource?.isInitialized) {
            this.logger.log('🔄 Closing database connection pool...');
            await this.dataSource.destroy();
            this.dataSource = null;
            this.logger.log('✅ Database connection pool closed');
        }
    }

    async forceClose(): Promise<void> {
        this.connectionCount = 0;
        await this.closePool();
    }

    getActiveConnections(): number {
        return this.connectionCount;
    }

    isInitialized(): boolean {
        return this.dataSource?.isInitialized ?? false;
    }
}
