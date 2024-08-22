import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import mongoose, { Document } from 'mongoose';
import { AccessRelation } from './accessrelation.schema';

export type ProjectDocument = Project & Document;

@Schema()
export class Project {
  @ApiProperty({description: 'Project Name'})
  @Prop({ required: true })
  name: string;

  @ApiProperty({description: 'start Date of project'})
  @Prop({ required: true })
  startDate: Date;

  @ApiProperty({description: 'User created On'})
  @Prop({ default: () => new Date() })
  createdOn: Date

  @ApiProperty({description: 'Created by'})
  @Prop({ required: false })
  createdBy: string;

  @ApiProperty({description: 'User created On'})
  @Prop({ default: () => new Date() })
  UpdateAt: Date

  @ApiProperty({description: 'Created by'})
  @Prop({ required: false })
  UpdatedBy: string;

}

export const ProjectSchema = SchemaFactory.createForClass(Project);
