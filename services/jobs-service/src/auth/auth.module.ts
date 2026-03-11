import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { AuthService } from './auth.service';

@Module({
  imports: [HttpModule, ConfigModule, LoggerModule.forRoot()],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
