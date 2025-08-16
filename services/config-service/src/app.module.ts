import { MiddlewareConsumer, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import {
  LoggerModule,
  RequestContextMiddleware,
} from '@netapp-cloud-datamigrate/logger-lib';
import { ConfigurationModule } from './configurations/configuration.module';
import { WorkManagerModule } from './work-manager/work-manager.module';
import { WorkflowModule } from './workflow/workflow.module';
import { PathUploadModule } from './path-upload/path-upload.module';
import { SupportBundleModule } from './support-bundle/support-bundle.module';

@Module({
  imports: [
    HttpModule,
    LoggerModule.forRoot(),
    ConfigModule.forRoot({ load: [databaseConfig, appConfig] }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) =>
        configService.get('typeorm'),
      inject: [ConfigService],
    }),
    ConfigurationModule,
    WorkManagerModule,
    WorkflowModule,
    PathUploadModule,
    SupportBundleModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
