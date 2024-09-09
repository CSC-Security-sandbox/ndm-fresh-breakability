import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { AgentStatusStates } from 'constants/enums';
import { Document } from 'mongoose';

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }) 
export class AgentStatus extends Document {
  @ApiProperty({ description: 'projectId' })
  @Prop({ required: true })
  projectId: string;

  @ApiProperty({ description: 'clientId' })
  @Prop({ required: true })
  clientId: string;

  @ApiProperty({ description: 'status' })
  @Prop({ required: true, enum: AgentStatusStates, default: AgentStatusStates.Offline })
  status: string;

  @ApiProperty({ description: 'agentName' })
  @Prop({ required: true })
  agentName: string;

  @ApiProperty({ description: 'agentId' })
  @Prop({ required: true })
  agentId: string;

  @ApiProperty({ description: 'ipAddress' })
  @Prop({ required: true })
  ipAddress: string;

  @ApiProperty({ description: 'created_at' })
  @Prop({ type: Date })
  created_at: Date;

  @ApiProperty({ description: 'updated_at' })
  @Prop({ type: Date })
  updated_at: Date;
}

export const AgentStatusSchema = SchemaFactory.createForClass(AgentStatus);
