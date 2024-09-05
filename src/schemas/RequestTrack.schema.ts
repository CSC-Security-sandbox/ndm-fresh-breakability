import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { Document } from 'mongoose';
import { RequestType, ResponseStatus } from 'src/constants/status';

@Schema({ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })
export class RequestTrack extends Document {
  @ApiProperty({ description: 'Type of the request' })
  @Prop({ required: true, enum: RequestType, })
  requestType: RequestType;

  @ApiProperty({ description: 'Response' })
  @Prop({ required: false })
  response: string;

  @ApiProperty({ description: 'Status of the request' })
  @Prop({ required: true, enum: ResponseStatus, default: ResponseStatus.Pending })
  status: ResponseStatus;

  @ApiProperty({ description: 'Unique identifier for the request' })
  @Prop({ required: true })
  requestId: string;

  @ApiProperty({ description: 'agentId' })
  @Prop({ required: true })
  agentId: string;

  @ApiProperty({ description: 'Creation timestamp' })
  @Prop({ type: Date })
  created_at: Date;

  @ApiProperty({ description: 'Last updated timestamp' })
  @Prop({ type: Date })
  updated_at: Date;
}

export const RequestTrackSchema = SchemaFactory.createForClass(RequestTrack);
