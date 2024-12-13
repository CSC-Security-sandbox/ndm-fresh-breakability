import { registerAs } from '@nestjs/config';
import { InventoryEntity } from '../entities/inventory.entity';
import { DataSourceOptions } from 'typeorm';

export default registerAs(
  'typeorm',
  (): DataSourceOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    schema: process.env.SCHEMA,
    synchronize: false,
    dropSchema: false,
    ssl: false,
    logging: false,
    entities: [
      InventoryEntity
    ],
    migrations: [],
  }),
);
