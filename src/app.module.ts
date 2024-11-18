import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import { ConfigurationModule } from './configurations/configuration.module';
;


@Module({
  imports: [
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
export class AppModule {}
