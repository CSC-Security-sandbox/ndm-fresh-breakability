import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { RabbitMQService } from 'src/rabbitmq/rabbitmq.service';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';
import appConfig from 'src/config/app.config';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { FileServerWorkingDirectoryMappingEntity } from 'src/entities/fileserver_workingdirectory_mapping.entity';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';

@Module({
    imports: [
        LoggerModule.forRoot(),
        ConfigModule.forRoot({ load: [appConfig] }),
        TypeOrmModule.forFeature([WorkerEntity, VolumeEntity, FileServerEntity, ConfigEntity, FileServerWorkingDirectoryMappingEntity]),
        AuthKeycloakModule,
    ],
    providers:[ConfigurationService, RabbitMQService],
    controllers: [ConfigurationController]
})
export class ConfigurationModule {}
