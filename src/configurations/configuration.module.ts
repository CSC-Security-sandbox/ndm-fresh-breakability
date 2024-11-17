import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkerEntity } from 'src/entities/worker.entity';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';
import { RabbitMQService } from 'src/rabbitmq/rabbitmq.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([WorkerEntity, VolumeEntity, FileServerEntity, ConfigEntity]),
    ],
    providers:[ConfigurationService, RabbitMQService],
    controllers: [ConfigurationController]
})
export class ConfigurationModule {}
