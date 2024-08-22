import { ConflictException, ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccessRelation } from 'src/schemas/accessrelation.schema';
import { AccessRelationDTO } from './dto/accessrelation.dto';

@Injectable()
export class AccessrelationService {
    constructor(
        @InjectModel(AccessRelation.name)
        private readonly model: Model<AccessRelation>,
    ) {}

    async createRelation(accessRelationDTO: AccessRelationDTO) {
        const found = await this.findByRelation(accessRelationDTO)
        if(found.length > 0)
            throw new ForbiddenException('Relation Already Exist')
        const newModel = new this.model(accessRelationDTO);
        return newModel.save();
    }

    findAll() {
        return this.model.find().populate(['user','role','project','customer']).exec();
    }

    async findByRelation(accessRelationDTO: AccessRelationDTO) {
        return await this.model.find(accessRelationDTO).exec();
    }

    findRelationsById(id: string) {
        return this.model.findById(id).populate(['user','role','project','customer']).exec();
    }

    async updateRelationsById(id: string, accessRelationDTO: AccessRelationDTO) {
        if(this.findByRelation(accessRelationDTO))
            throw new ForbiddenException('Relation Already Exist')
        return this.model.findByIdAndUpdate(id, accessRelationDTO, { new: true }).exec();
    }

    async deleteRelationById(id: string) {
        return this.model.findByIdAndDelete(id).populate(['user','role','project','customer']).exec();
    }
}
