import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigurationModule } from './configurations/configuration.module';
import { EventsModule } from './events/events.module';
import { AuthModule } from './auth/auth.module';
import { APP_GUARD } from '@nestjs/core';
import { WsJwtGuard } from './auth/ws-jwt/ws-jwt.guard';
import { EventsGateway } from './events/events.gateway';

@Module({
  imports: [
    MongooseModule.forRoot('mongodb+srv://jafog21906:AbbfB5zo1Vz95NGF@cluster0.dpy2h.mongodb.net/'),ConfigurationModule, EventsModule, AuthModule],
  controllers: [],
  providers: [{
    provide: APP_GUARD,
    useClass: WsJwtGuard
  }],
})
export class AppModule {}
