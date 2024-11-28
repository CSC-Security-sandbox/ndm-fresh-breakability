import { TypeOrmModule } from '@nestjs/typeorm';
import { Module } from '@nestjs/common';
import { TaskEntity } from '../entities/task.entity';
import { TaskService } from './tasks.service';
import { TaskController } from './tasks.controller';
import { EventsModule } from '../events/events.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([TaskEntity]),
        EventsModule
    ],
    providers: [TaskService],
    controllers: [TaskController],
})
export class TaskModule {}
