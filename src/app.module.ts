import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisConsumerModule } from './redis-consumer/redis-consumer.module';
import { InventoryModule } from './inventory/inventory.module';
import { WorkflowModule } from './workflow/workflow.module';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [appConfig,databaseConfig,],
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
