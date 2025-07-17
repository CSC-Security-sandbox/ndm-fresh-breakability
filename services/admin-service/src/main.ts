import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Use console.log for bootstrap logging since LoggerFactory is scoped
  console.log('[Bootstrap] Starting admin service...');

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
  console.log('[Bootstrap] Admin Service is running on port 3000');

  // Handle graceful shutdown - NestJS will handle most of the cleanup
  const gracefulShutdown = async (signal: string) => {
    console.log(`[Bootstrap] Received ${signal}, starting graceful shutdown...`);

    try {
      // Close the HTTP server first to stop accepting new requests
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            console.log('[Bootstrap] HTTP server closed');
            resolve();
          }
        });
      });
      
      // NestJS will handle the rest of the cleanup automatically
      await app.close();
      console.log('[Bootstrap] Application shut down successfully');
      process.exit(0);
    } catch (error) {
      console.error('[Bootstrap] Error during graceful shutdown:', error);
      process.exit(1);
    }
  };

  // Handle process termination signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

bootstrap().catch((error) => {
  console.error('[Bootstrap] Failed to start application:', error);
  process.exit(1);
});
