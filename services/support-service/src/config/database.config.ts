import { registerAs } from '@nestjs/config';
import { DataSourceOptions } from 'typeorm';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { ProjectEntity } from 'src/entities/project.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { JobConfigEntity } from 'src/entities/jobconfig.entity';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { OperationErrorEntity } from 'src/entities/operation-error.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { WorkerJobRunMap } from 'src/entities/workerjobrun.entity';
import { WorkerStatsEntity } from 'src/entities/worker-stats.entity';

export default registerAs(
  'typeorm',
  (): DataSourceOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: +(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    synchronize: false,
    dropSchema: false,
    logging: false,
    schema: process.env.SCHEMA,
    entities: [
      ConfigEntity,
      FileServerEntity,
      VolumeEntity,
      ProjectEntity,
      JobConfigEntity,
      JobRunEntity,
      OperationErrorEntity,
      WorkerEntity,
      WorkerJobRunMap,
      WorkerStatsEntity,
    ],
    migrations: [],
  }),
);
