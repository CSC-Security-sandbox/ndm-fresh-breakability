import { Module } from "@nestjs/common";
import { HealthcheckController } from "./healthcheck.controller";
import { HealthcheckService } from "./healthcheck.service";
import { LoggerModule } from "@netapp-cloud-datamigrate/logger-lib";
import { TypeOrmModule } from "@nestjs/typeorm";
import { WorkerStatsEntity } from "src/entities/worker-stats.entity";
import { WorkerEntity } from "src/entities/worker.entity";
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';

@Module({
  imports: [
    LoggerModule.forRoot(),
    TypeOrmModule.forFeature([WorkerEntity, WorkerStatsEntity]),
    AuthKeycloakModule,
  ],
  controllers: [HealthcheckController],
  providers: [HealthcheckService],
})
export class HealthcheckModule { }
