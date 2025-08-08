import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { InventoryEntity } from "../entities/inventory.entity";
import { OperationErrorEntity } from "../entities/operation-error.entity";
import { OperationsEntity } from "../entities/operation.entity";
import { TaskErrorEntity } from "../entities/task-error.entity";
import { TaskEntity } from "../entities/task.entity";
import { InventoryService } from "./inventory.service";
import { SpeedLogEntity, SpeedLogEntryEntity } from '../entities/speed-test.entity';
import {
  LoggerModule
} from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [
    LoggerModule.forRoot(),
    TypeOrmModule.forFeature([
      InventoryEntity,
      TaskEntity,
      OperationsEntity,
      TaskErrorEntity,
      OperationErrorEntity,
      SpeedLogEntity,
      SpeedLogEntryEntity,
    ]),
  ],

  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
