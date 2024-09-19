import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentEntity } from 'src/entities/agent.entity';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';


@Module({
  imports: [
    TypeOrmModule.forFeature([AgentEntity]),
  ],
  controllers: [AgentsController],
  providers: [AgentsService]
})
export class AgentsModule {}
