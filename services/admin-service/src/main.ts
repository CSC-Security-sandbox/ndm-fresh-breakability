import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
  const config = new DocumentBuilder()
    .setTitle('Admin Service')
    .setDescription(
      'Admin Service - admin services handle account, project, user and role management',
    )
    .setVersion('1.0')
    .addServer(
      process.env.SWAGGER_BASEURL || 'http://localhost:3000',
      process.env.SWAGGER_SERVER_NAME || 'Local Development',
    )
    .addTag('admin')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('/api/v1/admin-docs', app, document, {
    jsonDocumentUrl: '/swagger/json',
  });
  app.useGlobalPipes(new ValidationPipe());
  app.enableCors();
  await app.listen(3000);
}

bootstrap();
