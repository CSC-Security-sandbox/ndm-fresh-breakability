import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UserService } from './users.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import mongoose from 'mongoose';
import { User } from 'src/schemas/User.schema';
import { CreateUserDTO } from './dto/createuser.dto';

describe('UsersController', () => {
    let usersController: UsersController;
    let userService: UserService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [UsersController],
            providers: [
                {
                    provide: UserService,
                    useValue: {
                        createUser: jest.fn(),
                        findAllUsers: jest.fn(),
                        findUsersById: jest.fn(),
                        updateUsersById: jest.fn(),
                        deleteUserById: jest.fn(),
                    },
                },
            ],
        }).compile();

        usersController = module.get<UsersController>(UsersController);
        userService = module.get<UserService>(UserService);
    });

    describe('createUser', () => {
        it('should create a user successfully', async () => {
            const createUserDTO: CreateUserDTO = { name: 'testuser', createdBy: "test", password: 'password123', email: "test@test.com" };
            const createdUser = { ...createUserDTO, _id: 'someId' };
            jest.spyOn(userService, 'createUser').mockResolvedValue(createdUser as any);
    
            expect(await usersController.createUser(createUserDTO)).toEqual(createdUser);
        });
    });

    describe('getUsers', () => {
        it('should return a list of users', async () => {
            const userPagenDTO = { page: 1, limit: 10 }; // Adjust according to your DTO
            const users = [{ name: 'John Doe', email: 'john@example.com' }];
            jest.spyOn(userService, 'findAllUsers').mockResolvedValue(users as any);
    
            expect(await usersController.getUsers(userPagenDTO)).toEqual(users);
        });
    });
    
    describe('getUsersById', () => {
        it('should return a user by id', async () => {
            const id = '66c4276756cfac7c8b89a6df';
            const user = { _id: id, name: 'John Doe', email: 'john@example.com' };
            jest.spyOn(userService, 'findUsersById').mockResolvedValue(user as any);
    
            expect(await usersController.getUsersById(id)).toEqual(user);
        });
    
        it('should throw BadRequestException for invalid id', async () => {
            const id = 'invalidId';
            await expect(usersController.getUsersById(id)).rejects.toThrow(BadRequestException);
        });
    
        it('should throw NotFoundException if user not found', async () => {
            const id = '66c4276756cfac7c8b89a6df';
            jest.spyOn(userService, 'findUsersById').mockResolvedValue(null);
    
            await expect(usersController.getUsersById(id)).rejects.toThrow(NotFoundException);
        });
    });

    
    describe('updateUser', () => {
        it('should update a user successfully', async () => {
            const id = '66c4276756cfac7c8b89a6df';
            const updateUserDTO = { name: 'John Doe Updated' }; // Adjust according to your DTO
            const updatedUser = { _id: id, ...updateUserDTO };
            jest.spyOn(userService, 'updateUsersById').mockResolvedValue(updatedUser as any);
    
            expect(await usersController.updateUser(id, updateUserDTO)).toEqual(updatedUser);
        });
    
        it('should throw BadRequestException for invalid id', async () => {
            const id = 'invalidId';
            const updateUserDTO = { name: 'John Doe Updated' };
            await expect(usersController.updateUser(id, updateUserDTO)).rejects.toThrow(BadRequestException);
        });
    
        it('should throw NotFoundException if user not found', async () => {
            const id = '66c4276756cfac7c8b89a6df';
            const updateUserDTO = { name: 'John Doe Updated' };
            jest.spyOn(userService, 'updateUsersById').mockResolvedValue(null);
    
            await expect(usersController.updateUser(id, updateUserDTO)).rejects.toThrow(NotFoundException);
        });
    });
    
    describe('deleteUser', () => {
        it('should delete a user successfully', async () => {
            const id = '66c4276756cfac7c8b89a6df';
            const user = { _id: id, name: 'John Doe', email: 'john@example.com' };
            jest.spyOn(userService, 'deleteUserById').mockResolvedValue(user as any);
    
            expect(await usersController.deleteUser(id)).toEqual(user);
        });
    
        it('should throw BadRequestException for invalid id', async () => {
            const id = 'invalidId';
            await expect(usersController.deleteUser(id)).rejects.toThrow(BadRequestException);
        });
    
        it('should throw NotFoundException if user not found', async () => {
            const id = '66c4276756cfac7c8b89a6df';
            jest.spyOn(userService, 'deleteUserById').mockResolvedValue(null);
    
            await expect(usersController.deleteUser(id)).rejects.toThrow(NotFoundException);
        });
    });
    
    
});
