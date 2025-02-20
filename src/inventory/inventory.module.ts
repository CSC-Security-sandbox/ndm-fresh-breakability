import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { TaskEntity } from 'src/entities/task.entity';
import { OperationsEntity } from 'src/entities/operation.entity';
import { OperationErrorEntity } from 'src/entities/operation-error.entity';
import { TaskErrorEntity } from 'src/entities/task-error.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([InventoryEntity,TaskEntity,OperationsEntity, OperationErrorEntity, TaskErrorEntity]),
    ],
    controllers: [InventoryController],
    providers: [InventoryService],
    exports: [InventoryService]
})
export class InventoryModule { }
