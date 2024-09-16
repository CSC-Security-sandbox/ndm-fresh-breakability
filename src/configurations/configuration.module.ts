import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentEntity } from 'src/entities/agent.entity';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { Configuration, ConfigurationSchema } from '../schemas/Configuration.schema';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([AgentEntity, VolumeEntity, FileServerEntity, ConfigEntity]),
        MongooseModule.forFeature([{
            name: Configuration.name,
            schema: ConfigurationSchema
        },
    ]),
    ],
    providers:[ConfigurationService],
    controllers: [ConfigurationController]
})
export class ConfigurationModule {}
