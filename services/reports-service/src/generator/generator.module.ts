import { Module } from "@nestjs/common";
import { PDFGeneratorService } from "./pdf-generator.service";
import { OnModuleInit } from "@nestjs/common";

@Module({
  providers: [PDFGeneratorService],
  exports: [PDFGeneratorService],
})
export class GeneratorModule implements OnModuleInit {
  constructor(private readonly pdfGenerator: PDFGeneratorService) {}

  onModuleInit() {
    this.pdfGenerator.initBrowser();
  }
}
