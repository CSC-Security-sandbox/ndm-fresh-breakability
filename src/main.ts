import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { RedisIoAdapter } from './adapter/redis.adapter';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();

  app.useWebSocketAdapter(redisIoAdapter);

  app.enableCors();
  
  app.useGlobalPipes(new ValidationPipe())
  const config = new DocumentBuilder()
  .setTitle('Config service')
  .setDescription('Configuration Mangement')
  .setVersion('1.0')
  .addTag('config')
  .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document);
  app.enableShutdownHooks();

  await app.listen(3000, '0.0.0.0');
  
  // const appContext = await NestFactory.createApplicationContext(AppModule);
  
}
bootstrap();
