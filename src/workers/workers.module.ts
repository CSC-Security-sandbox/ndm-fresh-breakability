import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkerEntity } from 'src/entities/worker.entity';
import { WorkersController } from './workers.controller';
import { WorkersService } from './workers.service';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';


@Module({
  imports: [
    TypeOrmModule.forFeature([WorkerEntity]),
    AuthKeycloakModule
  ],
  controllers: [WorkersController],
  providers: [WorkersService]
})
export class WorkerModule {}
