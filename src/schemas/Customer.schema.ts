import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { ApiProperty } from "@nestjs/swagger";
import { AccessRelation } from "./accessrelation.schema";
import mongoose from "mongoose";

@Schema()
export class Customer{
    @ApiProperty({description: 'Customer name'})
    @Prop({unique: true, required: true})
    orgName: string;
   
    @ApiProperty({description: 'Customer email'})
    @Prop({unique: true, required: true})
    email: string;

    @ApiProperty({description: 'Created On'})
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

export const CustomerSchema = SchemaFactory.createForClass(Customer)

