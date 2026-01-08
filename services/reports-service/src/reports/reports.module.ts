import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsEntity } from 'src/entities/reports.entity';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { FileServerEntity } from 'src/entities/fileserver.entity';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { TemporalClientService } from 'src/temporal/temporal-client.service';
import { ConsolidatedReportService } from 'src/activities/consolidated-report/consolidated-report.service';
import { DiscoveryService } from 'src/discovery/discovery.service';

@Module({
    imports: [
        TypeOrmModule.forFeature([ReportsEntity, InventoryEntity, FileServerEntity]),
        AuthKeycloakModule,
        LoggerModule.forRoot()
    ],
    providers: [TemporalClientService, ConsolidatedReportService, DiscoveryService],
    controllers: [ReportsController],
})
export class ReportsModule {}
