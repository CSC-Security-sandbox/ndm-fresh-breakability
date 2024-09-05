import { Injectable, Logger } from '@nestjs/common';
import { AgentsStatusPageDto } from './dto/agents.page.dto';
import { AgentStatus } from 'src/schemas/Agent.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';



@Injectable()
export class AgentsService {
    private logger : Logger = new Logger(AgentStatus.name);
    constructor(
        @InjectModel(AgentStatus.name)
        private readonly model: Model<AgentStatus>,
    ) {}


    async findAllAgents(agentsStatusPageDto: AgentsStatusPageDto) {
        const { page, limit, sort = 'createdOn', order = 'asc', ...filter} = agentsStatusPageDto;
        let data = [], total = 0
        if(page && limit && sort && order) {
            const skip = (parseInt(page) - 1) * parseInt(limit);
            data = await this.model.find(filter).sort({[sort]: order}).skip(skip).limit(parseInt(limit)).exec();  
            total = await this.model.find(filter).countDocuments(filter)
            return { data, total}
        }
        data = await this.model.find().exec();
        total = await this.model.find().countDocuments();
        return { data, total}
    }

   
}
