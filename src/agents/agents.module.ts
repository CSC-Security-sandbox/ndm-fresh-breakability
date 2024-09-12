import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentEntity } from 'src/entities/agent.entity';


@Module({
  imports: [
    TypeOrmModule.forFeature([AgentEntity]),
  ],
  controllers: [AgentsController],
  providers: [AgentsService]
})
export class AgentsModule {}
