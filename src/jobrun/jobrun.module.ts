import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobRunEntity } from '../entities/jobrun.entity';
import { JobRunService } from './jobrun.service';
import { JobRunController } from './jobrun.controller';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobConfigService } from 'src/jobconfig/jobconfig.service';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        TypeOrmModule.forFeature([JobConfigEntity, JobRunEntity]),
    ],
    providers: [JobRunService, JobConfigService],
    controllers: [JobRunController]
})
export class JobRunModule {}
