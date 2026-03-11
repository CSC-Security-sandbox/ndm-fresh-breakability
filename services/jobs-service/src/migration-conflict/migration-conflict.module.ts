import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MigrationConflictService } from './migration-conflict.service';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobRunEntity } from '../entities/jobrun.entity';

@Module({
  imports: [TypeOrmModule.forFeature([JobConfigEntity, JobRunEntity])],
  providers: [MigrationConflictService],
  exports: [MigrationConflictService],
})
export class MigrationConflictModule {}
