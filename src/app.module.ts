import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigurationModule } from './configurations/configuration.module';
import { EventsModule } from './events/events.module';
import { AuthModule } from './auth/auth.module';
import { APP_GUARD } from '@nestjs/core';
import { WsJwtGuard } from './auth/ws-jwt/ws-jwt.guard';
import { EventsGateway } from './events/events.gateway';
import { ConfigModule } from '@nestjs/config';
import rabbitmqConfig from './config/rabbitmq.config';
import { CommandService } from './consumers/command.service';
import { CommandController } from './consumers/command.controller';
import { RabbitMQService } from './rabbitmq/rabbitmq.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [rabbitmqConfig],
    }),
    MongooseModule.forRoot('mongodb+srv://jafog21906:AbbfB5zo1Vz95NGF@cluster0.dpy2h.mongodb.net/'),
    ConfigurationModule, EventsModule, AuthModule,
  ],
  controllers: [CommandController],
  providers: [{
    provide: APP_GUARD,
    useClass: WsJwtGuard
  },CommandService,RabbitMQService],
})
export class AppModule {}
