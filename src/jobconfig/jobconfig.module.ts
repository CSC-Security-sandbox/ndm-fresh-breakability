import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobConfigEntity, SpeedTestConfigEntity, SpeedTestConfigWorkerEntity, SpeedLogEntity, NetworkPerformanceResultEntity, SpeedTestResultEntity, SpeedLogEntryEntity } from 'src/entities/jobconfig.entity';
import { JobConfigController } from './jobconfig.controller';
import { JobConfigService } from './jobconfig.service';

import { InventoryEntity } from 'src/entities/inventory.entity';
import { JobIdMappingEntity } from '../entities/jobmapping.entity';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { ProjectEntity } from 'src/entities/project.entity';
import { VolumeEntity } from 'src/entities/volume.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { WorkflowService } from 'src/workflow/workflow.service';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { FileServerWorkingDirectoryMappingEntity } from 'src/entities/fileserver_workingdirectory_mapping.entity';

@Module({
    imports: [
        LoggerModule.forRoot(),
        TypeOrmModule.forFeature([JobConfigEntity, SpeedTestConfigEntity, SpeedTestConfigWorkerEntity, JobIdMappingEntity,InventoryEntity, ProjectEntity,VolumeEntity,FileServerEntity,FileServerWorkingDirectoryMappingEntity, JobRunEntity, SpeedLogEntity, NetworkPerformanceResultEntity, SpeedTestResultEntity, SpeedLogEntryEntity]),
    ],
    providers: [JobConfigService,WorkflowService],
    controllers: [JobConfigController]
})
export class JobConfigModule {}
