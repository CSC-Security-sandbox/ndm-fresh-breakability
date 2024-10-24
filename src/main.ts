import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  app.setGlobalPrefix('api/v1/report');

  app.useGlobalPipes(new ValidationPipe());

  const config = new DocumentBuilder()
  .setTitle('Reports service')
  .setDescription('Used for discovery of files')
  .setVersion('1.0')
  .addTag('Reports discovery')
  .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document,{
    jsonDocumentUrl: 'swagger/json',
  });
  app.enableShutdownHooks();
  app.set('trust proxy', true);
  
  app.enableCors();

  await app.listen(3006);
}
bootstrap();
