import { Injectable, ConflictException, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from 'src/schemas/User.schema';
import { CreateUserDTO } from './dto/createuser.dto';
import { UserPagenDTO } from './dto/userspage.dto';
import { UpdateUserDTO } from './dto/updateuser.dto';

@Injectable()
export class UserService {
    constructor(
        @InjectModel(User.name)
        private readonly userModel: Model<User>,
    ) {}

    createUser(createUserDTO: CreateUserDTO) {
        const newUser = new this.userModel(createUserDTO);
        try {
            return  newUser.save();
        } catch (error) {
            if (error.code === 11000) 
                throw new ConflictException('Username already exists');
            else 
                throw new InternalServerErrorException('Could not create user');
        }
    }

    async findAllUsers(userPagenDTO: UserPagenDTO) {
        const { page = 1, limit = 10 } = userPagenDTO;
        const skip = (page - 1) * limit;
        return this.userModel.find().skip(skip).limit(limit).exec();
    }

    async findUsersById(id: string) {
        return this.userModel.findById(id).exec();
    }

    async updateUsersById(id: string, updateUserDTO: UpdateUserDTO) {
        return this.userModel.findByIdAndUpdate(id, updateUserDTO, { new: true }).exec();
    }

    async deleteUserById(id: string) {
        return this.userModel.findByIdAndDelete(id).exec();
    }
}
