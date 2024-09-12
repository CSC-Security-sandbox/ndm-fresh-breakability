import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { Protocol } from 'src/constants/enums';

import { Document } from 'mongoose';
import { RequestType, ResponseStatus } from 'src/constants/status';

@Schema({ timestamps: true })
export class RequestTrack extends Document {
  @ApiProperty({ description: 'Type of the request' })
  @Prop({ required: true, enum: RequestType })
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

  @ApiProperty({ description: 'Protocal of the request' })
  @Prop({ required: true, enum: Protocol })
  protocol: Protocol;

  @ApiProperty({ description: 'Agent ID' })
  @Prop({ required: true })
  agentId: string;

  @ApiProperty({ description: 'Creation timestamp' })
  @Prop({ type: Date })
  createdAt: Date;

  @ApiProperty({ description: 'Last updated timestamp' })
  @Prop({ type: Date })
  updatedAt: Date;
}

export const RequestTrackSchema = SchemaFactory.createForClass(RequestTrack);
