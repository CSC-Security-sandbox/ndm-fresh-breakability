import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { ApiProperty } from "@nestjs/swagger";
import mongoose from "mongoose";
import { AccessRelation } from "./accessrelation.schema";

@Schema()
export class Role{
    @ApiProperty({description: 'Role Name'})
    @Prop({required: true})
    name :string;

    @ApiProperty({description: 'created On'})
    @Prop({ default: () => new Date() })
    createdOn: Date

    @ApiProperty({description: 'Created by'})
    @Prop({ required: false })
    createdBy: string;

    @ApiProperty({description: 'Updated On'})
    @Prop({ default: () => new Date() })
    UpdateAt: Date
  
    @ApiProperty({description: 'Updated by'})
    @Prop({ required: false })
    UpdatedBy: string;
}

export const RoleSchema = SchemaFactory.createForClass(Role)

