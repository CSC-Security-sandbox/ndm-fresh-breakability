import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AboutNdmController } from './about-ndm.controller';
import { AboutNdmService } from './about-ndm.service';
import { PrometheusService } from 'src/utils/prometheus';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { WorkerEntity } from '../entities/worker.entity';

@Module({
  imports: [LoggerModule.forRoot(), AuthKeycloakModule, TypeOrmModule.forFeature([WorkerEntity])],
  controllers: [AboutNdmController],
  providers: [PrometheusService, AboutNdmService],
})
export class AboutNdmModule {}
