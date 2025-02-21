import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobConfigEntity } from 'src/entities/jobconfig.entity';
import { JobConfigController } from './jobconfig.controller';
import { JobConfigService } from './jobconfig.service';

import { InventoryEntity } from 'src/entities/inventory.entity';
import { JobIdMappingEntity } from '../entities/jobmapping.entity';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { ProjectEntity } from 'src/entities/project.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([JobConfigEntity, JobIdMappingEntity,InventoryEntity, ProjectEntity, JobRunEntity]),
    ],
    providers: [JobConfigService],
    controllers: [JobConfigController]
})
export class JobConfigModule {}
