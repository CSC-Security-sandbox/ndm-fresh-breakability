import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigurationService } from './configuration.service';
import { ConfigurationController } from './configuration.controller';
import { Configuration, ConfigurationSchema } from '../schemas/Configuration.schema';
import { EventsGateway } from 'src/events/events.gateway';
import { Session, SessionSchema } from 'src/schemas/Session.schema';

@Module({
    imports: [
        MongooseModule.forFeature([{
            name: Configuration.name,
            schema: ConfigurationSchema
        },
        {
            name: Session.name,
            schema: SessionSchema
        }
    ]),
        // EventsGateway
    ],
    providers:[ConfigurationService, EventsGateway],
    controllers: [ConfigurationController]
})
export class ConfigurationModule {}
