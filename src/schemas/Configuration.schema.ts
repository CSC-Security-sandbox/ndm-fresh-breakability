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

    @ApiProperty({ description: 'List of mounts' })
    @Prop({ type: [Mount], default: [] })
    mounts: Mount[];

    @ApiProperty({ description: 'List of shares' })
    @Prop({ type: [Share], default: [] })
    shares: Share[];
}

export const ConfigurationSchema = SchemaFactory.createForClass(Configuration)