import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { ApiProperty } from "@nestjs/swagger";
import { AccessRelation } from "./accessrelation.schema";
import mongoose from "mongoose";

@Schema()
export class User{
    @ApiProperty({description: 'userName'})
    @Prop({unique: true, required: true})
    userName: string;
   
    @ApiProperty({description: 'Email'})
    @Prop({unique: true, required: true})
    email: string;

    @ApiProperty({description: 'User created On'})
    @Prop({ default: () => new Date() })
    createdOn: Date

    @ApiProperty({description: 'Created by'})
    @Prop({ required: false })
    createdBy: string;

    @ApiProperty({description: 'User Updated On'})
    @Prop({ default: () => new Date() })
    UpdateAt: Date
  
    @ApiProperty({description: 'Updated by'})
    @Prop({ required: false })
    UpdatedBy: string;

}

export const UserSchema = SchemaFactory.createForClass(User)

