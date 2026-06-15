import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { SyncEmail } from 'src/entities/sync-email.entity';
import { LoggerModule } from '@netapp-cloud-datamigrate/logger-lib';
import { AuthKeycloakModule } from '@netapp-cloud-datamigrate/auth-lib';

@Module({
  imports: [
    TypeOrmModule.forFeature([GlobalSettings, SyncEmail]),
    AuthKeycloakModule,
    LoggerModule.forRoot(),
  ],
  controllers: [EmailController],
  providers: [EmailService],
})
export class EmailModule {}
