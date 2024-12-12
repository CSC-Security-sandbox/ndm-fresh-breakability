import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobConfigEntity } from 'src/entities/jobconfig.entity';
import { JobConfigService } from './jobconfig.service';
import { JobConfigController } from './jobconfig.controller';
import { JobMappingService } from '../jobmappings/jobmapping.service';
import { JobIdMappingEntity } from '../entities/jobmapping.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([JobConfigEntity, JobIdMappingEntity]),
    ],
    providers: [JobConfigService, JobMappingService],
    controllers: [JobConfigController]
})
export class JobConfigModule {}
