import { Module } from '@nestjs/common';
import { PdfService } from './pdf.service';
import { PdfController } from './pdf.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryEntity } from 'src/entities/inventory.entity';
import { ReportsEntity } from 'src/entities/reports.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryEntity, ReportsEntity]),
],
  controllers: [PdfController],
  providers: [PdfService],
})
export class PdfModule {}
