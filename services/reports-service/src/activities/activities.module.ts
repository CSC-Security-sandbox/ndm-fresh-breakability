import { Module } from '@nestjs/common';
import { GeneratorModule } from 'src/generator/generator.module';
import { ActivitiesService } from './activities.service';
import { DiscoveryReportService } from './discovery-report/discovery-report.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsEntity } from 'src/entities/reports.entity';
import { JobRunEntity } from 'src/entities/jobrun.entity';
import { ConfigModule } from '@nestjs/config';
import databaseConfig from 'src/config/database.config';
import appConfig from 'src/config/app.config';
import temporalConfig from 'src/config/temporal.config';

@Module({
  imports: [
    ConfigModule.forRoot({ load: [databaseConfig, appConfig, temporalConfig] }), 
    TypeOrmModule.forFeature([ReportsEntity, JobRunEntity]),
    GeneratorModule
  ],
  providers: [
    ActivitiesService,
    DiscoveryReportService,
  ],
  exports: [
    ActivitiesService
  ],
})
export class ActivitiesModule {}
