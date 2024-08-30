import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigurationModule } from './configurations/configuration.module';
import { AppConfig } from './config/AppConfig';

@Module({
  imports: [
    MongooseModule.forRoot(AppConfig.DB_URI), ConfigurationModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
