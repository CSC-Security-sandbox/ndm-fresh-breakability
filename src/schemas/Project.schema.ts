import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import mongoose, { Document } from 'mongoose';


export type ProjectDocument = Project & Document;

@Schema()
export class Project {

  @Prop({ type:mongoose.Schema.Types.ObjectId, auto: true })
  _id: mongoose.Schema.Types.ObjectId;
  
  @ApiProperty({ description: 'Project Name' })
  @Prop({ required: true })
  name: string;

  @ApiProperty({ description: 'Start Date of project' })
  @Prop({ required: true })
  startDate: Date;

  @ApiProperty({ description: 'Date when the project was created' })
  @Prop({ default: () => new Date() })
  createdAt: Date;

  @ApiProperty({ description: 'Date when the project was last updated' })
  @Prop({ default: () => new Date() })
  updateAt: Date;

  @Prop({ default: false})
  isArchived: boolean

}

export const ProjectSchema = SchemaFactory.createForClass(Project);