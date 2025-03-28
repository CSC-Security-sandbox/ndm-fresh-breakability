import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskEntity } from 'src/entities/task.entity';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';

@Module({
  imports:[
    TypeOrmModule.forFeature([TaskEntity]),
    AuthKeycloakModule
  ],
  controllers: [TasksController],
  providers: [TasksService]
})
export class TasksModule {}
