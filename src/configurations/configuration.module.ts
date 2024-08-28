import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigurationService } from './configuration.service';
import { ConfigurationController } from './configuration.controller';
import { Configuration, ConfigurationSchema } from '../schemas/Configuration.schema';

@Module({
    imports: [
        MongooseModule.forFeature([{
            name: Configuration.name,
            schema: ConfigurationSchema
        }])
    ],
    providers:[ConfigurationService],
    controllers: [ConfigurationController]
})
export class ConfigurationModule {}
