import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobRunEntity } from '../entities/jobrun.entity';
import { JobRunService } from './jobrun.service';
import { JobRunController } from './jobrun.controller';
import { JobEntity } from '../entities/job.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([JobRunEntity, JobEntity]),
    ],
    providers: [JobRunService],
    controllers: [JobRunController]
})
export class JobRunModule {}
