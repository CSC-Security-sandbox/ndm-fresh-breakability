import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobMappingService } from './jobmapping.service';
import { JobMappingController } from './jobmapping.controller';
import { JobMappingEntity } from '../entities/jobmapping.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([JobMappingEntity]),
    ],
    providers: [JobMappingService],
    controllers: [JobMappingController]
})
export class JobMappingModule {}