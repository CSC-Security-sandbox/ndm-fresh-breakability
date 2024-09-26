import { registerAs } from "@nestjs/config";
import { AgentEntity } from "src/entities/agent.entity";
import { ConfigEntity } from "src/entities/config.entity";
import { FileServerEntity } from "src/entities/fileserver.entity";

import { InventoryEntity } from "src/entities/inventory.entity";
import { JobEntity } from "src/entities/job.entity";
import { ProjectEntity } from "src/entities/project.entity";
import { RequestTrackEntity } from "src/entities/requesttrack.entity";
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
        entities: [AgentEntity, RequestTrackEntity, ConfigEntity, InventoryEntity, FileServerEntity, VolumeEntity, ProjectEntity, JobEntity],
        migrations: []
    }))