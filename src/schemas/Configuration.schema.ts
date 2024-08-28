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
    other = 'other',
    dell = 'dell',
    emc = 'emc'
}

@Schema({ timestamps: true })
export class Configuration {
    @ApiProperty({description: 'Project Id' })
    @Prop({ type: MongooseSchema.Types.ObjectId , ref: 'Project' })
    projectId: ObjectId;

    @ApiProperty({description: 'Configuration type'})
    @Prop({ required: true })
    configurationType: ConfigurationType;
   
    @ApiProperty({description: 'Server type'})
    @Prop({ default: ServerType.other })
    serverType: ServerType;

    @ApiProperty({description: 'Protocol'})
    @Prop({ required: true })
    protocol: Protocol;

    @ApiProperty({description: 'Username'})
    @Prop({ required: true })
    userName: string;

    @ApiProperty({description: 'Host'})
    @Prop({ required: true })
    host: string;
}

export const ConfigurationSchema = SchemaFactory.createForClass(Configuration)