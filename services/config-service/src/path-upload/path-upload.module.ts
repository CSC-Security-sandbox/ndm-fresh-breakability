import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import appConfig from '../config/app.config';
import { WorkflowModule } from '../workflow/workflow.module';
import { PathUploadsEntity } from '../entities/pathupload.entity';
import { PathUploadController } from './path-upload.controller';
import { PathUploadService } from './path-upload.service';
import { WorkflowService } from '../workflow/workflow.service';
import { FileServerEntity } from '../entities/fileserver.entity';
import { VolumeEntity } from '../entities/volume.entity';
import { User } from '../entities/user.entity';
import { JobConfigEntity } from 'src/entities/jobconfig.entity';
import { JobRunEntity } from 'src/entities/jobrun.entity';

@Module({
    imports: [
        LoggerModule.forRoot(),
        ConfigModule.forRoot({ load: [appConfig] }),
        TypeOrmModule.forFeature([PathUploadsEntity, FileServerEntity, VolumeEntity, User, JobConfigEntity, JobRunEntity]),
        AuthKeycloakModule,
        WorkflowModule
    ],
    providers: [PathUploadService, WorkflowService],
    controllers: [PathUploadController]
})
export class PathUploadModule { }
