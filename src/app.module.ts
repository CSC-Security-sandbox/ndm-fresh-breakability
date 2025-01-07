import { MiddlewareConsumer, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import { ConfigurationModule } from './configurations/configuration.module';
import { LoggerFactory, LoggerModule, RequestLoggerMiddleware } from '@netapp-cloud-datamigrate/logger-lib';


@Module({
  imports: [
    LoggerModule.forRoot(),
    ConfigModule.forRoot({ load: [databaseConfig,appConfig] }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) =>
        configService.get('typeorm'),
      inject: [ConfigService],
    }),
    ConfigurationModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestLoggerMiddleware)
      .forRoutes('*');
  }
}
