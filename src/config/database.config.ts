import { registerAs } from '@nestjs/config';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { JobConfigEntity } from 'src/entities/jobconfig.entity';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { ProjectEntity } from 'src/entities/project.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
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
        __dirname + '/../entities/*.entity{.ts,.js}',
    ],
    migrations: [
    ],
  }),
);
