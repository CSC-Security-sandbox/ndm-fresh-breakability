import { registerAs } from '@nestjs/config';
import { InventoryEntity } from '../entities/inventory.entity';
import { DataSourceOptions } from 'typeorm';
import { TaskEntity } from '../entities/task.entity';
import { OperationsEntity } from '../entities/operation.entity';
import { TaskErrorEntity } from '../entities/task-error.entity';
import { OperationErrorEntity } from '../entities/operation-error.entity';
import { SpeedLogEntity, SpeedLogEntryEntity } from '../entities/speed-test.entity';

export default registerAs(
  'typeorm',
  (): DataSourceOptions => ({
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
    extra:{
      max: parseInt(process.env.DB_MAX_CONNECTIONS ?? '5', 10),
      connectTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT ?? '50000', 10),
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT ?? '30000', 10),
    },
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
  }),
);
