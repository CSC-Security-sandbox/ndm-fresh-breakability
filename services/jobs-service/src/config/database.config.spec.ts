import { JobIdMappingEntity } from './../entities/jobmapping.entity';
import { DataSourceOptions } from 'typeorm';
import { WorkerEntity } from 'src/entities/worker.entity';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { JobConfigEntity } from 'src/entities/jobconfig.entity';
import { ProjectEntity } from 'src/entities/project.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import typeormConfig from 'src/config/database.config';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { TaskEntity } from 'src/entities/task.entity';
import { OperationsEntity } from 'src/entities/operation.entity';
import { WorkerJobRunMap } from 'src/entities/workerjobrun.entity';

describe('TypeORM Config', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('should return the correct TypeORM configuration', () => {
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    process.env.DB_USER = 'testuser';
    process.env.DB_PASSWORD = 'testpassword';
    process.env.DB_NAME = 'testdb';

    const config = typeormConfig();

    const expectedConfig: DataSourceOptions = {
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'testuser',
      password: 'testpassword',
      database: 'testdb',
      synchronize: false,
      dropSchema: false,
      logging: false,
      entities: [
        WorkerEntity,
        ConfigEntity,
        InventoryEntity,
        FileServerEntity,
        VolumeEntity,
        ProjectEntity,
        JobConfigEntity,
        JobIdMappingEntity,
        JobRunEntity,
        TaskEntity,
        OperationsEntity,
        WorkerJobRunMap,
      ],
      migrations: [],
    };

    expect(config).toEqual(expectedConfig);
  });
});
