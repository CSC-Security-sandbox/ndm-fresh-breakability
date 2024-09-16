import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentEntity } from 'src/entities/agent.entity';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([AgentEntity, VolumeEntity, FileServerEntity, ConfigEntity]),
    ],
    providers:[ConfigurationService],
    controllers: [ConfigurationController]
})
export class ConfigurationModule {}
