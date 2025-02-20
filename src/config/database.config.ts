import { registerAs } from '@nestjs/config';
import { InventoryEntity } from '../entities/inventory.entity';
import { DataSourceOptions } from 'typeorm';
import { TaskEntity } from 'src/entities/task.entity';
import { OperationsEntity } from 'src/entities/operation.entity';
import { TaskErrorEntity } from 'src/entities/task-error.entity';
import { OperationErrorEntity } from 'src/entities/operation-error.entity';

export default registerAs(
  'typeorm',
  (): DataSourceOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    schema: process.env.DB_SCHEMA,
    synchronize: false,
    dropSchema: false,
    ssl: false,
    logging: false,
    entities: [
      InventoryEntity,
      TaskEntity,
      OperationsEntity,
      TaskErrorEntity,
      OperationErrorEntity
    ],
    migrations: [],
  }),
);
