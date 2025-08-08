import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import { DiscoveryModule } from './discovery/discovery.module';
import { InventoryEntity } from './entities/inventory.entity';
import { ReportsEntity } from './entities/reports.entity';
import { PdfModule } from './pdf/pdf.module';
import { JobRunModule } from './job-run/job-run.module';
import { OverviewModule } from './overview/overview.module';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';

@Module({
  imports: [
    LoggerModule.forRoot(),
    ConfigModule.forRoot({ load: [databaseConfig, appConfig] }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) =>
        configService.get('typeorm'),
      inject: [ConfigService],
    }),
    DiscoveryModule,
    OverviewModule,
    TypeOrmModule.forFeature([InventoryEntity, ReportsEntity]),
    PdfModule,
    JobRunModule
  ],
  controllers: [],
  providers: [],
})
// export class AppModule implements NestModule {
//   configure(consumer: MiddlewareConsumer) {
//     consumer.apply(RequestContextMiddleware).forRoutes('*');
//   }
// }

export class AppModule {}
