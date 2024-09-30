import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkerEntity } from 'src/entities/worker.entity';
import { WorkersController } from './workers.controller';
import { WorkersService } from './workers.service';


@Module({
  imports: [
    TypeOrmModule.forFeature([WorkerEntity]),
  ],
  controllers: [WorkersController],
  providers: [WorkersService]
})
export class WorkerModule {}
