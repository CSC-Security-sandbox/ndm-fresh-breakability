import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MigrationConflictService } from './migration-conflict.service';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobRunEntity } from '../entities/jobrun.entity';
import { SoftDeleteJobConfigRepository } from '../repositories/soft-delete-jobconfig.repository';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            JobConfigEntity,
            JobRunEntity,
        ]),
    ],
    providers: [MigrationConflictService, SoftDeleteJobConfigRepository],
    exports: [MigrationConflictService],
})
export class MigrationConflictModule { }
