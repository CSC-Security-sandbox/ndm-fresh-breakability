/**
 * Upgrade Activity Module
 * 
 * NestJS module for upgrade-related activities.
 */

import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../../auth/auth.module';
import { UpgradeActivityService } from './upgrade.activity.service';

@Module({
  imports: [
    HttpModule,
    ConfigModule,
    AuthModule,
  ],
  providers: [UpgradeActivityService],
  exports: [UpgradeActivityService],
})
export class UpgradeActivityModule {}
