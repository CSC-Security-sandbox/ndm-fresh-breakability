import { Module } from '@nestjs/common';
import { PdfService } from './pdf.service';
import { PdfController } from './pdf.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { ReportsEntity } from 'src/entities/reports.entity';
import { DiscoveryService } from 'src/discovery/discovery.service';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';
import { GeneratorModule } from 'src/generator/generator.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryEntity, ReportsEntity]), 
    AuthKeycloakModule,
    GeneratorModule
  ],
  controllers: [PdfController],
  providers: [PdfService, DiscoveryService],
})
export class PdfModule {}
