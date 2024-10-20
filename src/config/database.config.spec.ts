import { DataSourceOptions } from 'typeorm';
import { WorkerEntity } from "src/entities/worker.entity";
import { ConfigEntity } from "src/entities/config.entity";
import { FileServerEntity } from "src/entities/fileserver.entity";
import { InventoryEntity } from "src/entities/inventory.entity";
import { JobEntity } from "src/entities/job.entity";
import { ProjectEntity } from "src/entities/project.entity";
import { RequestTrackEntity } from "src/entities/requesttrack.entity";
import { VolumeEntity } from "src/entities/volume.entity";
import typeormConfig from 'src/config/database.config';


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
      ssl: {
        rejectUnauthorized: false,
      },
      logging: true,
      entities: [
        WorkerEntity,
        RequestTrackEntity,
        ConfigEntity,
        InventoryEntity,
        FileServerEntity,
        VolumeEntity,
        ProjectEntity,
        JobEntity,
      ],
      migrations: []
    };

    expect(config).toEqual(expectedConfig);
  });

});
