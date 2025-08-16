import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { ResponseInterceptor } from '@netapp-cloud-datamigrate/api-handler-lib';
import {
  customErrorDTOList,
  customSuccessDTOList,
} from './constants/custom-response-message';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const loggerFactory = app.resolve(LoggerFactory);
  
  app.useGlobalInterceptors(
    new ResponseInterceptor(
      customSuccessDTOList,
      customErrorDTOList,
      await loggerFactory,
    ),
  );

  const configService = app.get(ConfigService);
  const host: string = configService.get<string>('app.http.host', '0.0.0.0');
  const port: number = configService.get<number>('app.http.port', 3000) ?? 3000;

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.setGlobalPrefix('api/v1/');

  app.enableShutdownHooks();
  app.enableCors();
  await app.listen(port, '0.0.0.0');
  }
bootstrap();
