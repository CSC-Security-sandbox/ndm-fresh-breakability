import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { MongooseModule } from '@nestjs/mongoose';

import { Session, SessionSchema } from 'src/schemas/Session.schema';
import { RabbtMqService } from './rabbitmq.service';
import { EventsController } from './events.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{
        name: Session.name,
        schema: SessionSchema
    }])
],
  exports: [EventsGateway, MongooseModule],
  providers: [EventsGateway, RabbtMqService],
  controllers: [EventsController]
})
export class EventsModule {}
