import { registerAs } from "@nestjs/config";
import { WorkerEntity } from "src/entities/worker.entity";
import { ConfigEntity } from "src/entities/config.entity";
import { FileServerEntity } from "src/entities/fileserver.entity";
import { ProjectEntity } from "src/entities/project.entity";
import { VolumeEntity } from "src/entities/volume.entity";
import { DataSourceOptions } from "typeorm";

export default registerAs('typeorm', (): DataSourceOptions => (
    {
        type: 'postgres',
        host: process.env.DB_HOST,
        port: +process.env.DB_PORT,
        username: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        synchronize: false,
        dropSchema: false,
        ssl: {
            rejectUnauthorized: false, 
        },
        logging: true,
        entities: [WorkerEntity, ConfigEntity, FileServerEntity, VolumeEntity, ProjectEntity],
        migrations: []
    }))