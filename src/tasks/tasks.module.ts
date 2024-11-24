import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Module } from '@nestjs/common';
import { TaskEntity } from '../entities/task.entity';
import { TaskService } from './tasks.service';
import { TaskController } from './tasks.controller';

@Module({
    imports: [
        TypeOrmModule.forFeature([TaskEntity])
    ],
    providers: [TaskService],
    controllers: [TaskController],
})
export class TaskModule {}
