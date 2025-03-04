import { Module } from '@nestjs/common';
import { SettingService } from './setting.service';
import { SettingController } from './setting.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GlobalSettings } from 'src/entities/global-setting.entity';

@Module({
  imports: [  TypeOrmModule.forFeature([
    GlobalSettings,
  ]),],
  controllers: [SettingController],
  providers: [SettingService],
})
export class SettingModule {}
