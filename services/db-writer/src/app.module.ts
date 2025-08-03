import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisConsumerModule } from './redis-consumer/redis-consumer.module';
import { InventoryModule } from './inventory/inventory.module';
import { WorkflowModule } from './workflow/workflow.module';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import temporalConfig from './config/temporal.config';
import { ScheduleModule } from '@nestjs/schedule';
import {
  LoggerModule,
  RequestContextMiddleware,
} from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [
    {
      ...LoggerModule.forRoot(),
      global: true,
    },
    ConfigModule.forRoot({
      load: [appConfig,databaseConfig,temporalConfig],
      isGlobal: true
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService): Promise<TypeOrmModuleOptions> => {
        const typeormConfig = configService.get<TypeOrmModuleOptions>('typeorm');
        if (!typeormConfig) {
          throw new Error('TypeORM configuration is missing from ConfigService!');
        }
        return typeormConfig;
      },
      inject: [ConfigService],
    }),
    RedisConsumerModule,
    InventoryModule,
    WorkflowModule,
    ScheduleModule.forRoot()
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
