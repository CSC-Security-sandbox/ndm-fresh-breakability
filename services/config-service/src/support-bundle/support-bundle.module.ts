import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupportBundleEntity } from 'src/entities/support-bundle-log.entity';
import { SupportBundleController } from './support-bundle.controller';
import { SupportBundleService } from './support-bundle.service';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { WorkflowService } from 'src/workflow/workflow.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { ProjectEntity } from 'src/entities/project.entity';
import { NetworkLatencyEntity } from 'src/entities/network-latency.entity';

@Module({
  imports: [
    LoggerModule.forRoot(),
    TypeOrmModule.forFeature([SupportBundleEntity, ProjectEntity, NetworkLatencyEntity]),
  ],
  controllers: [SupportBundleController],
  providers: [SupportBundleService, WorkflowService, ConfigService, JwtService],
})
export class SupportBundleModule {}
