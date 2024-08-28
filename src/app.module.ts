import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigurationModule } from './configurations/configuration.module';

@Module({
  imports: [
    MongooseModule.forRoot('mongodb+srv://jafog21906:AbbfB5zo1Vz95NGF@cluster0.dpy2h.mongodb.net/'), ConfigurationModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
