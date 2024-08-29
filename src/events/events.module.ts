import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { MongooseModule } from '@nestjs/mongoose';

import { Session, SessionSchema } from 'src/schemas/Session.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{
        name: Session.name,
        schema: SessionSchema
    }])
],
  exports: [EventsGateway, MongooseModule],
  providers: [EventsGateway]
})
export class EventsModule {}
