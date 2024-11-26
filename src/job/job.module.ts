import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobEntity } from 'src/entities/job.entity';
import { JobService } from './job.service';
import { JobController } from './job.controller';

@Module({
    imports: [
        TypeOrmModule.forFeature([JobEntity]),
    ],
    providers: [JobService],
    controllers: [JobController]
})
export class JobModule {}
