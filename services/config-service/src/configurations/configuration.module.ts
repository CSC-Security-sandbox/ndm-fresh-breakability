import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import appConfig from 'src/config/app.config';
import { ConfigEntity } from 'src/entities/config.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { FileServerWorkingDirectoryMappingEntity } from 'src/entities/fileserver_workingdirectory_mapping.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { WorkerEntity } from 'src/entities/worker.entity';
import { WorkflowModule } from 'src/workflow/workflow.module';
import { ConfigurationController } from './configuration.controller';
import { ConfigurationService } from './configuration.service';
import { ProjectEntity } from 'src/entities/project.entity';
import { SendMailService } from 'src/util/send-email';
import { WorkerStatsEntity } from 'src/entities/worker-stats.entity';
import { JobConfigEntity } from 'src/entities/jobconfig.entity';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { PathUploadsEntity } from 'src/entities/pathupload.entity';
import { ManagementServerEntity } from 'src/entities/ManagementServerEntity';

@Module({
    imports: [
        LoggerModule.forRoot(),
        ConfigModule.forRoot({ load: [appConfig] }),
        TypeOrmModule.forFeature([
            WorkerEntity, 
            VolumeEntity, 
            FileServerEntity, 
            ConfigEntity, 
            FileServerWorkingDirectoryMappingEntity, 
            ProjectEntity, 
            WorkerStatsEntity, 
            JobConfigEntity, 
            JobRunEntity, 
            PathUploadsEntity, 
            ManagementServerEntity
        ]),
        AuthKeycloakModule,
        WorkflowModule
    ],
    providers:[ConfigurationService,SendMailService],
    controllers: [ConfigurationController]
})
export class ConfigurationModule {}
