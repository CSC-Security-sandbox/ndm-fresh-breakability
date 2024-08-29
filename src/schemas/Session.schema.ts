import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
export class Session extends Document {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  socketId: string;
}

export const SessionSchema = SchemaFactory.createForClass(Session);
