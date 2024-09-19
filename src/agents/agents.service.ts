import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindManyOptions, Repository } from 'typeorm';

import { AgentEntity } from 'src/entities/agent.entity';
import { AgentsStatusPageDto } from './dto/agents.page.dto';


@Injectable()
export class AgentsService {
  private logger: Logger = new Logger(AgentsService.name);

  constructor(
    @InjectRepository(AgentEntity)
    private readonly agentEntity: Repository<AgentEntity>,
  ) {}

  async findAllAgents(agentsStatusPageDto: AgentsStatusPageDto) {
    const { page, limit, sort = 'createdAt', order = 'ASC', ...filter } = agentsStatusPageDto;
    
    const findOptions: FindManyOptions<AgentEntity> = {
      where: filter, order: { [sort]: order }, 
    };

    let data = [], total = 0;
    if (page && limit) {
      findOptions.skip = (parseInt(page) - 1) * parseInt(limit); 
      findOptions.take = parseInt(limit); 
      data = await this.agentEntity.find(findOptions);
      total = await this.agentEntity.count({ where: filter });
    } else {
      data = await this.agentEntity.find(findOptions);
      total = await this.agentEntity.count();
    }
    return { data, total };
  }
}
