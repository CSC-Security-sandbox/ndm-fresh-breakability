import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { WorkerEntity } from "src/entities/worker.entity";
import { WorkersController } from "./workers.controller";
import { WorkersService } from "./workers.service";
import appConfig from "src/config/app.config";
import { ConfigModule } from "@nestjs/config";
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkerEntity]),
    ConfigModule.forRoot({ load: [appConfig] }),
    AuthKeycloakModule
  ],
  controllers: [WorkersController],
  providers: [WorkersService],
})
export class WorkerModule {}
