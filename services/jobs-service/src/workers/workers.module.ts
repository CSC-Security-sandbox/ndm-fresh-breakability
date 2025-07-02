import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { WorkerEntity } from "src/entities/worker.entity";
import { WorkersController } from "./workers.controller";
import { WorkersService } from "./workers.service";
import appConfig from "src/config/app.config";
import { ConfigModule } from "@nestjs/config";
import { WorkerJobRunMap } from "src/entities/workerjobrun.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkerEntity, WorkerJobRunMap]),
    ConfigModule.forRoot({ load: [appConfig] }),
  ],
  controllers: [WorkersController],
  providers: [WorkersService],
})
export class WorkerModule {}
