import { ConfigEntity } from "src/entities/config.entity";
import { FileServerEntity } from "src/entities/fileserver.entity";
import { ProjectEntity } from "src/entities/project.entity";
import { WorkerEntity } from "src/entities/worker.entity";
import { DataSourceOptions } from 'typeorm';

import typeormConfig from 'src/config/database.config';
import { VolumeEntity } from "src/entities/volume.entity";
import { JobConfigEntity } from "src/entities/jobconfig.entity";
import { JobRunEntity } from "src/entities/jobrun.entity";
import { FileServerWorkingDirectoryMappingEntity } from "src/entities/fileserver_workingdirectory_mapping.entity";


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
        FileServerEntity,
        VolumeEntity,
        ProjectEntity,
        JobConfigEntity,
        JobRunEntity,
        FileServerWorkingDirectoryMappingEntity
      ],
      migrations: []
    };

    expect(config).toEqual(expectedConfig);
  });

});
