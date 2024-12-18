import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DiscoveryModule } from './discovery/discovery.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import databaseConfig from './config/database.config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OverviewModule } from './overview/overview.module';
import appConfig from './config/app.config';
import { InventoryEntity } from './entities/inventory.entity';
import { ReportsEntity } from './entities/reports.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ load: [databaseConfig, appConfig] }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) =>
        configService.get('typeorm'),
      inject: [ConfigService],
    }),
    DiscoveryModule,
    OverviewModule,
    TypeOrmModule.forFeature([InventoryEntity,ReportsEntity]) 
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
