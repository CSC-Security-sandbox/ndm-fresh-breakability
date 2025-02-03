import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { TaskEntity } from 'src/entities/task.entity';
import { OperationsEntity } from 'src/entities/operation.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([InventoryEntity,TaskEntity,OperationsEntity]),
    ],
    controllers: [InventoryController],
    providers: [InventoryService]
})
export class InventoryModule { }
