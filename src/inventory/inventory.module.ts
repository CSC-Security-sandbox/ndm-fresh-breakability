import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { InventoryEntity } from "src/entities/inventory.entity";
import { OperationErrorEntity } from "src/entities/operation-error.entity";
import { OperationsEntity } from "src/entities/operation.entity";
import { TaskErrorEntity } from "src/entities/task-error.entity";
import { TaskEntity } from "src/entities/task.entity";
import { InventoryService } from "./inventory.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InventoryEntity,
      TaskEntity,
      OperationsEntity,
      TaskErrorEntity,
      OperationErrorEntity,
    ]),
  ],
  controllers: [],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
