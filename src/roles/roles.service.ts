import { ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Role } from 'src/schemas/Role.schema';
import { CreateRoleDTO } from './dto/createrole.dto';
import { SchemaError } from 'src/contants/statuscodes';
import { RolePagenDTO } from './dto/rolespage.dto';
import { UpdateRoleDTO } from './dto/updaterole.dto';

@Injectable()
export class RolesService {
    constructor(
        @InjectModel(Role.name)
        private readonly model: Model<Role>,
    ) {}

    createRole(createRoleDTO: CreateRoleDTO) {
        const newUser = new this.model({...createRoleDTO, createdOn: new Date()});
        try {
            return  newUser.save();
        } catch (error) {
            if (error.code === SchemaError.ConflictException) 
                throw new ConflictException('Role already exists');
            else 
                throw new InternalServerErrorException('Could not create Role');
        }
    }

    async findAllRole(RolePageDTO: RolePagenDTO) {
        const { page = 1, limit = 10 } = RolePageDTO;
        const skip = (page - 1) * limit;
        return this.model.find().skip(skip).limit(limit).exec();
    }

    async findRoleById(id: string) {
        return this.model.findById(id).exec();
    }

    async updateRoleById(id: string, updatedRoleDTO: UpdateRoleDTO) {
        return this.model.findByIdAndUpdate(id, {...updatedRoleDTO, UpdateAt: new Date()}, { new: true }).exec();
    }

    async deleteRoleById(id: string) {
        return this.model.findByIdAndDelete(id).exec();
    }
}
