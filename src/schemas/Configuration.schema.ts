import { ApiProperty } from "@nestjs/swagger";
import { ObjectId, Schema as MongooseSchema } from "mongoose";
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";

export enum Protocol {
    NFS = 'NFS',
    SMB = 'SMB'
}

export enum ConfigurationType {
    file = 'FILE',
    objectStorage = 'OBJECT_STORAGE'
}

export enum ServerType {
    other = 'OtherNAS',
    dell = 'dell',
    emc = 'emc'
}

export enum Mapping {
    automatic = 'Automatic',
    manual = 'Manual',
    none = 'None'
}

@Schema({ _id: false })
export class Mount {
    @ApiProperty({ description: 'Mount path' })
    @Prop({ required: true })
    mountPath: string;
}

@Schema({ _id: false })
export class Share {
    @ApiProperty({ description: 'Share path' })
    @Prop({ required: true })
    sharePath: string;
}

@Schema({ _id: false })
export class Volume {
  @ApiProperty({ description: 'Mount path' })
  @Prop({ required: true, type: String })
  mountPath: string;

  @ApiProperty({ description: 'Share path' })
  @Prop({ required: true, type: String })
  sharePath: string;

  @ApiProperty({ description: 'Mapping' })
  @Prop({ type: String, enum: Mapping })
  mapping: Mapping;
}

@Schema({ timestamps: true })
export class Configuration {
    @ApiProperty({description: 'Project Id' })
    @Prop({ type: MongooseSchema.Types.ObjectId , ref: 'Project' })
    projectId: ObjectId;

    @ApiProperty({description: 'Name'})
    @Prop({ required: true, type: String })
    name: string;

    @ApiProperty({description: 'Configuration type'})
    @Prop({ required: true, enum: ConfigurationType, type: String })
    configurationType: ConfigurationType;
   
    @ApiProperty({description: 'Server type'})
    @Prop({ default: ServerType.other, enum: ServerType, type: String })
    serverType: ServerType;

    @ApiProperty({description: 'Protocol'})
    @Prop({ required: true, enum: Protocol, type: String })
    protocol: Protocol;

    @ApiProperty({description: 'Username'})
    @Prop({ required: true, type: String })
    userName: string;

    @ApiProperty({description: 'Host'})
    @Prop({ required: true, type: String })
    host: string;

    @ApiProperty({ description: 'Array of volumes with mountPath and sharePath' })
    @Prop({ default: [], type: [Volume] })
    volumes: Volume[];
}

export const ConfigurationSchema = SchemaFactory.createForClass(Configuration)