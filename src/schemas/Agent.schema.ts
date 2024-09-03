import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }) 
export class AgentStatus extends Document {
  @Prop({ required: true })
  projectId: string;

  @Prop({ required: true })
  clientId: string;

  @Prop({ required: true, enum: ['Active', 'Inactive'], default: 'Inactive' })
  status: string;

  @Prop({ required: true })
  agentName: string;

  @Prop({ required: true })
  agentId: string;

  @Prop({ type: Date })
  created_at: Date;

  @Prop({ type: Date })
  updated_at: Date;
}

export const AgentStatusSchema = SchemaFactory.createForClass(AgentStatus);
