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
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const loggerFactory = app.resolve(LoggerFactory);
  app.useGlobalInterceptors(
    new ResponseInterceptor(
      customSuccessDTOList,
      customErrorDTOList,
      await loggerFactory,
    ),
  );
  // Enable graceful shutdown
  app.enableShutdownHooks();

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
  
  const server = await app.listen(3000);
  logger.log('Admin Service is running on port 3000');

  // Graceful shutdown handling
  const gracefulShutdown = async (signal: string) => {
    logger.log(`Received ${signal}, starting graceful shutdown...`);
    
    try {
      // Close the HTTP server
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            logger.log('HTTP server closed');
            resolve();
          }
        });
      });

      // Close the NestJS application
      await app.close();
      logger.log('NestJS application closed');
      
      // Exit process
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  };

  // Handle process termination signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start application:', error);
  process.exit(1);
});
