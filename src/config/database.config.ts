import { registerAs } from "@nestjs/config";
import { DataSourceOptions } from "typeorm";

import { JobEntity } from "src/entities/job.entity";

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
        entities: [JobEntity],
    }))