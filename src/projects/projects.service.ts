import { ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SchemaError } from 'src/contants/statuscodes';
import { Project } from 'src/schemas/Project.schema';
import { CreateProjectDTO } from './dto/createproject.dto';
import { UpdatedProjectDTO } from './dto/updateproject.dto';
import { ProjectPageDTO } from './dto/projectpage.dto';

@Injectable()
export class ProjectsService {
    constructor(
        @InjectModel(Project.name)
        private readonly model: Model<Project>,
    ) {}

    createProject(createProjectDTO: CreateProjectDTO) {
        const newUser = new this.model({...createProjectDTO, createdOn: new Date()});
        try {
            return  newUser.save();
        } catch (error) {
            if (error.code === SchemaError.ConflictException) 
                throw new ConflictException('Username already exists');
            else 
                throw new InternalServerErrorException('Could not create user');
        }
    }

    async findAllProject(projectPageDTO: ProjectPageDTO) {
        const { page = 1, limit = 10 } = projectPageDTO;
        const skip = (page - 1) * limit;
        return this.model.find().skip(skip).limit(limit).exec();
    }

    async findProjectById(id: string) {
        return this.model.findById(id).exec();
    }

    async updateProjectById(id: string, updatedProjectDTO: UpdatedProjectDTO) {
        return this.model.findByIdAndUpdate(id, {...updatedProjectDTO, UpdateAt: new Date()}, { new: true }).exec();
    }

    async deleteProjectById(id: string) {
        return this.model.findByIdAndDelete(id).exec();
    }
}


