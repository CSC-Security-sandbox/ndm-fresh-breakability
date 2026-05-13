import { Module } from '@nestjs/common';
import { PDFGeneratorService } from './pdf-generator.service';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [LoggerModule.forRoot()],
  providers: [PDFGeneratorService],
  exports: [PDFGeneratorService],
})
export class GeneratorModule {}
