import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppConfig } from './config/AppConfig';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.useGlobalPipes(new ValidationPipe())
  const config = new DocumentBuilder()
  .setTitle('Config service')
  .setDescription('Configuration Mangement')
  .setVersion('1.0')
  .addTag('config')
  .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document);

  await app.listen(AppConfig.SERVER_PORT || 3000);
}
bootstrap();
