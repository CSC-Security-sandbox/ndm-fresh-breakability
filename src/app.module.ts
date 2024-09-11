import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { WsJwtGuard } from './auth/ws-jwt/ws-jwt.guard';
import { ConfigurationModule } from './configurations/configuration.module';
import { EventsModule } from './events/events.module';
import { AgentsModule } from './agents/agents.module';
import { AppConfig } from './config/AppConfig';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [],
    }),
    MongooseModule.forRoot('mongodb+srv://admin:XKam5vuZ0rvykgIX@personal.cyjsz.mongodb.net/'),
    ConfigurationModule, EventsModule, AuthModule, AgentsModule,
  ],
  controllers: [],
  providers: [{
    provide: APP_GUARD,
    useClass: WsJwtGuard
  } ],
})
export class AppModule {}
