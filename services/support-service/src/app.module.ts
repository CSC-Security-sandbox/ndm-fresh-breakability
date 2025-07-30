import { Module } from '@nestjs/common';
import { WorkerModule } from './worker/worker.module';
import { ActivitiesModule } from './activities/activities.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import temporalConfig from './config/temporal.config';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [appConfig, databaseConfig, temporalConfig] }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
       configService.getOrThrow<TypeOrmModuleOptions>('typeorm'),
    }),
    WorkerModule,
    ActivitiesModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

