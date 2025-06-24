import { Module,Logger} from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { JobRunController } from './job-run.controller';
import { JobRunService } from './job-run.service';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { TaskEntity } from 'src/entities/task.entity';
import { ReportsEntity } from 'src/entities/reports.entity';
import { CsvService } from 'src/csv/csv_export.service';

@Module({
  imports: [TypeOrmModule.forFeature([JobRunEntity,InventoryEntity, TaskEntity, ReportsEntity])],
  controllers: [JobRunController],
  providers: [JobRunService, CsvService,Logger]
})
export class JobRunModule {}
