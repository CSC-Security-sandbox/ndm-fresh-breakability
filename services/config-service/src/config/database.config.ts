import { registerAs } from '@nestjs/config';
import { DataSourceOptions } from 'typeorm';
import { WorkerEntity } from 'src/entities/worker.entity';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { ProjectEntity } from 'src/entities/project.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { JobConfigEntity } from 'src/entities/jobconfig.entity';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { WorkerJobRunMap } from 'src/entities/workerjobrun.entity';
import { FileServerWorkingDirectoryMappingEntity } from 'src/entities/fileserver_workingdirectory_mapping.entity';
import { WorkerStatsEntity } from 'src/entities/worker-stats.entity';
import { PathUploadsEntity } from 'src/entities/pathupload.entity';
import { SupportBundleEntity } from 'src/entities/support-bundle-log.entity';
import { ManagementServerEntity } from 'src/entities/ManagementServerEntity';

export default registerAs(
  'typeorm',
  (): DataSourceOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    synchronize: false,
    dropSchema: false,
    logging: false,
    schema: process.env.SCHEMA,
    entities: [
      WorkerEntity,
      ConfigEntity,
      FileServerEntity,
      VolumeEntity,
      ProjectEntity,
      JobConfigEntity,
      JobRunEntity,
      FileServerWorkingDirectoryMappingEntity,
      WorkerJobRunMap,
      WorkerStatsEntity,
      PathUploadsEntity,
      SupportBundleEntity,
      ManagementServerEntity,
    ],
    migrations: [],
  }),
);
