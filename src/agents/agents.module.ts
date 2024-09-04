import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentStatus, AgentStatusSchema } from 'src/schemas/Agent.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{
        name: AgentStatus.name,
        schema: AgentStatusSchema
    },
  ])
  ],
  controllers: [AgentsController],
  providers: [AgentsService]
})
export class AgentsModule {}
