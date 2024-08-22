import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { User } from 'src/schemas/User.schema';
import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import { UserService } from './users.service';
import { Model } from 'mongoose';
import { CreateUserDTO } from './dto/createuser.dto';
import { UpdateUserDTO } from './dto/updateuser.dto';

const mockUserModel = {
    save: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    exec: jest.fn(),
};

describe('UserService', () => {
    let service: UserService;
    let userModel: Model<User>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UserService,
                {
                    provide: getModelToken(User.name),
                    useValue: mockUserModel,
                },
            ],
        }).compile();

        service = module.get<UserService>(UserService);
        userModel = module.get<Model<User>>(getModelToken(User.name));
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });


    describe('findAllUsers', () => {
        it('should return a paginated list of users', async () => {
            const users = [{ username: 'user1' }, { username: 'user2' }];
            (mockUserModel.find as jest.Mock).mockReturnValue({
                skip: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(users),
            } as any);

            const userPagenDTO = { page: 1, limit: 10 };
            const result = await service.findAllUsers(userPagenDTO);
            expect(result).toEqual(users);
        });
    });

    describe('findUsersById', () => {
        it('should return a user by ID', async () => {
            const user = { username: 'user1' };
            (mockUserModel.findById as jest.Mock).mockReturnValue({
                exec: jest.fn().mockResolvedValue(user),
            } as any);

            const result = await service.findUsersById('someid');
            expect(result).toEqual(user);
        });
    });

    describe('updateUsersById', () => {
        it('should update a user by ID', async () => {
            const updatedUser: UpdateUserDTO = { name: 'updateduser' };
            (mockUserModel.findByIdAndUpdate as jest.Mock).mockReturnValue({
                exec: jest.fn().mockResolvedValue(updatedUser),
            } as any);

            const updateUserDTO = { name: 'updateduser' };
            const result = await service.updateUsersById('someid', updateUserDTO);
            expect(result).toEqual(updatedUser);
        });
    });

    describe('deleteUserById', () => {
        it('should delete a user by ID', async () => {
            const deletedUser = { username: 'deleteduser' };
            (mockUserModel.findByIdAndDelete as jest.Mock).mockReturnValue({
                exec: jest.fn().mockResolvedValue(deletedUser),
            } as any);

            const result = await service.deleteUserById('someid');
            expect(result).toEqual(deletedUser);
        });
    });
});
