import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CircularDependencyService } from './circular-dependency.service';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobRunEntity } from '../entities/jobrun.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            JobConfigEntity,
            JobRunEntity,
        ]),
    ],
    providers: [CircularDependencyService],
    exports: [CircularDependencyService],
})
export class CircularDependencyModule { }
