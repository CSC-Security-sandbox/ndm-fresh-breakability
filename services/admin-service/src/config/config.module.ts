import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config } from 'dotenv';
import keycloakConfig from './keycloak.config';
import workerRegisterConfig from './workerregister.config';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import prometheusConfig from './prometheus.config';

config(); // Load .env file

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Makes config available throughout the app
      load: [keycloakConfig, workerRegisterConfig, prometheusConfig], // Load keycloak config
    }), // Automatically loads .env
    TypeOrmModule.forRoot({
      type: 'postgres', // Adjust according to your DB type
      host: process.env.DATABASE_HOST,
      port: parseInt(process.env.DATABASE_PORT, 10),
      username: process.env.DATABASE_USERNAME,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
      schema: process.env.DATABASE_SCHEMA,
      autoLoadEntities: process.env.AUTOLOAD_ENTITIES === 'true',
      synchronize: process.env.SYNCHRONIZE === 'true',
    }),
    LoggerModule.forRoot(),
  ],
})
export class AppConfigModule {}
