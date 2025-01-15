import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { JobRunController } from './job-run.controller';
import { JobRunService } from './job-run.service';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { TaskEntity } from 'src/entities/task.entity';
import { ReportsEntity } from 'src/entities/reports.entity';

@Module({
  imports: [TypeOrmModule.forFeature([JobRunEntity,InventoryEntity, TaskEntity, ReportsEntity])],
  controllers: [JobRunController],
  providers: [JobRunService]
})
export class JobRunModule {}
