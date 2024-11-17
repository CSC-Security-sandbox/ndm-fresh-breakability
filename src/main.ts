import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);


  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL],
      queue: 'datamigrate-queue',
      noAck: false,
      queueOptions: {
        durable: true,
        arguments: {
          'x-queue-type': 'quorum', 
        },
      },
    },
  });

  await app.startAllMicroservices();

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  
  app.setGlobalPrefix('api/v1/')
  
  app.useGlobalPipes(new ValidationPipe())
  const config = new DocumentBuilder()
  .setTitle('Job service')
  .setDescription('Job Management')
  .setVersion('1.0')
  .build();
  
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document,{
    jsonDocumentUrl: 'swagger/json',
  });
  
  app.enableShutdownHooks();
  app.set('trust proxy', true);
  
  app.enableCors();
  
  await app.listen(3001, '0.0.0.0');
}
bootstrap();





