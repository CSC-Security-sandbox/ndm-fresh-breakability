import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import databaseConfig from './config/database.config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryEntity } from './entities/inventory.entity';
import { AppConfigModule } from './config/config.module';
import { InventoryModule } from './inventory/inventory.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [databaseConfig],
      isGlobal: true
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) =>
        configService.get('typeorm'),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([InventoryEntity]),
    AppConfigModule,
    InventoryModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule { }

