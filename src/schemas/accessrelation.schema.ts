import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import mongoose from "mongoose";
import { User } from "./User.schema";
import { Role } from "./Role.schema";
import { Project } from "./Project.schema";
import { Customer } from "./Customer.schema";

@Schema()
export class AccessRelation{
    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'User'})
    user: User

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Role'})
    role: Role

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Project'})
    project: Project

    @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Customer'})
    customer: Customer
}

export const AccessRelationSchema = SchemaFactory.createForClass(AccessRelation)

