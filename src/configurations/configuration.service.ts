import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Configuration } from '../schemas/Configuration.schema';
import { CreateConfigurationDto } from './dto/createconfiguration.dto';
import { DbQuery } from '../utils/utils.types';
import { EventsGateway } from 'src/events/events.gateway';

@Injectable()
export class ConfigurationService {
    constructor(
        @InjectModel(Configuration.name)
        private readonly configurationModel: Model<Configuration>,
        private readonly socket: EventsGateway
    ) {}

    async findConfiguration(query: DbQuery<Configuration>, model: Model<Configuration> = this.configurationModel): Promise<Configuration[]> {
        const { filter = {}, projection = undefined, options = undefined } = query;
        const data = await model.find(filter, projection, options).exec();
        return data;
    }

    async createConfiguration(createConfigurationDto: CreateConfigurationDto): Promise<Configuration> {
        const createdConfiguration = new this.configurationModel(createConfigurationDto);
        return createdConfiguration.save();
    }
    
    async update(id: Types.ObjectId, updateConfigurationDto: Partial<CreateConfigurationDto>): Promise<Configuration> {
        const updatedConfiguration = await this.configurationModel.findByIdAndUpdate(
            id,
            updateConfigurationDto,
            { new: true }
        )
        if (!updatedConfiguration) {
            throw new NotFoundException(`Configuration with ID ${id} not found`);
        }
        return updatedConfiguration;
    }

    async remove(id: Types.ObjectId): Promise<{ success: boolean; id: Types.ObjectId; }> {
        const result = await this.configurationModel.findByIdAndDelete(id);
        if (!result) {
            throw new NotFoundException(`Configuration with ID ${id} not found`);
        }
        return { success: true, id }
    }

    async send(id) {
        this.socket.sendToClient(id)
    }

    async sendToClient(id) {
        this.socket.sendToClient(id)
    }
}