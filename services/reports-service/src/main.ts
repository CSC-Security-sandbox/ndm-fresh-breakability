import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { Logger, ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ConfigService } from "@nestjs/config";
import * as hbs from "hbs";
import { join } from "path";
import { CustomResponseInterceptor } from './interceptors/custom-response.interceptor';
import {
  customErrorDTOList,
  customSuccessDTOList,
} from './constants/custom-response-message';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { Reflector } from '@nestjs/core';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  
  app.useGlobalInterceptors(
    new CustomResponseInterceptor(
      customSuccessDTOList,
      customErrorDTOList,
      app.get(Reflector),
      await app.resolve(LoggerFactory),
    ),
  );

  const configService = app.get(ConfigService);
  const host: string = configService.get<string>("app.http.host");
  const port: number = configService.get<number>("app.http.port");

  await app.startAllMicroservices();

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.setGlobalPrefix("api/v1/report");

  app.useGlobalPipes(new ValidationPipe());

  const config = new DocumentBuilder()
    .setTitle("Reports service")
    .setDescription("Used for discovery of files")
    .setVersion("1.0")
    .addTag("Reports discovery")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("reports-docs", app, document, {
    jsonDocumentUrl: "swagger/json",
  });
  app.enableShutdownHooks();
  app.set("trust proxy", true);
  app.setBaseViewsDir(join(__dirname, "..", "views"));
  app.setViewEngine("hbs");
  hbs.registerPartials(join(__dirname, "../templates/views/partials"));
  hbs.registerHelper("sum", (a, b) => a + b);

  Logger.log("Service Queue Microservice is listening...");
  app.enableCors();

  await app.listen(3006);
}
bootstrap();
