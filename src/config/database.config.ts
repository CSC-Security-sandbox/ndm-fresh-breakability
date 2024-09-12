import { registerAs } from "@nestjs/config";
import { AgentEntity } from "src/entities/agent.entity";
import { RequestTrackEntity } from "src/entities/requesttrack.entity";
import { DataSourceOptions } from "typeorm";

export default registerAs('typeorm', (): DataSourceOptions => (
    {
        type: 'postgres',
        host: process.env.DB_HOST,
        port: +process.env.DB_PORT,
        username: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        synchronize: true,
        dropSchema: false,
        ssl: {
            rejectUnauthorized: false, 
        },
        logging: true,
        entities: [AgentEntity, RequestTrackEntity],
        // migrations: [AgentEntity]
    }))