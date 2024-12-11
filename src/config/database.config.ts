import { registerAs } from "@nestjs/config";
import { WorkerEntity } from "src/entities/worker.entity";
import { ConfigEntity } from "src/entities/config.entity";
import { FileServerEntity } from "src/entities/fileserver.entity";

import { InventoryEntity } from "src/entities/inventory.entity";
import { JobConfigEntity } from "src/entities/jobconfig.entity";
import { ProjectEntity } from "src/entities/project.entity";
import { RequestTrackEntity } from "src/entities/requesttrack.entity";
import { VolumeEntity } from "src/entities/volume.entity";
import { DataSourceOptions } from "typeorm";
import { JobIdMappingEntity } from "../entities/jobmapping.entity";
import { JobRunEntity } from "../entities/jobrun.entity";
import { TaskEntity } from "../entities/task.entity";

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
        logging: true,
        entities: [WorkerEntity, RequestTrackEntity, ConfigEntity, InventoryEntity, FileServerEntity, VolumeEntity, ProjectEntity, JobConfigEntity, JobIdMappingEntity, JobRunEntity, TaskEntity],
        migrations: []
}))