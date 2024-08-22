import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from "@nestjs/common";
import { CreateUserDTO } from "./dto/createuser.dto";
import { UserService } from "./users.service";
import { UserPagenDTO } from "./dto/userspage.dto";
import mongoose from "mongoose";
import { UpdateUserDTO } from "./dto/updateuser.dto";
import { ApiAcceptedResponse, ApiBadRequestResponse, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { User } from "src/schemas/User.schema";


@ApiTags("User")
@Controller('users')
export class UsersController {
    constructor(private userService: UserService) {}

    @ApiOperation({ summary: 'Create a new User', description: 'Creates a user in the database and returns the newly created user object.'})
    @ApiCreatedResponse({ description: 'User has been created successfully.', type: User })
    @ApiBadRequestResponse({  description: 'Invalid input data. Check the provided user information.'})
    @Post()
    createUser(@Body() createUserDTO: CreateUserDTO) {
        return this.userService.createUser(createUserDTO);   
    }

    @ApiOperation({ summary: 'Get a paginated list of Users',  description: 'Returns a list of users based on the provided pagination parameters.'})
    @ApiOkResponse({ description: 'The list of users has been retrieved successfully.',  type: [User] })
    @ApiBadRequestResponse({
        description: 'Invalid pagination parameters.'
    })
    @Post('/all')
    async getUsers(@Body() userPagenDTO: UserPagenDTO) {
        return await this.userService.findAllUsers(userPagenDTO);
    }

    @ApiOperation({ summary: 'Get User by ID', description: 'Fetches a user by their unique user ID.' })
    @ApiParam({ name: 'id', description: 'The unique identifier of the user (MongoDB ObjectId).', required: true })
    @ApiOkResponse({ description: 'The user has been found successfully.', type: User })
    @ApiNotFoundResponse({ description: 'User not found for the provided ID.' })
    @ApiBadRequestResponse({ description: 'Invalid user ID format. Must be a valid MongoDB ObjectId.' })
    @Get(':id')
    async getUsersById(@Param('id') id: string) {
        const isValid = mongoose.Types.ObjectId.isValid(id);
        if (!isValid) throw new BadRequestException('Invalid User ID format.');
        
        const user = await this.userService.findUsersById(id);
        if (!user) throw new NotFoundException('User not found.');
        return user;
    }

    @ApiOperation({ summary: 'Update User by ID', description: 'Updates the details of an existing user using their unique ID.'})
    @ApiParam({name: 'id', description: 'The unique identifier of the user (MongoDB ObjectId).',required: true})
    @ApiOkResponse({description: 'The user has been updated successfully.', type: User})
    @ApiNotFoundResponse({description: 'User not found for the provided ID.'})
    @ApiBadRequestResponse({description: 'Invalid user ID format or invalid input data.'})
    @Patch(':id')
    async updateUser(@Param('id') id: string, @Body() updateUserDTO: UpdateUserDTO) {
        const isValid = mongoose.Types.ObjectId.isValid(id);
        if (!isValid) throw new BadRequestException('Invalid User ID format.');
        
        const user = await this.userService.updateUsersById(id, updateUserDTO);
        if (!user) throw new NotFoundException('User not found.');
        return user;
    }

    @ApiOperation({ summary: 'Delete User by ID',  description: 'Deletes an existing user using their unique ID.'})
    @ApiParam({ name: 'id',  description: 'The unique identifier of the user (MongoDB ObjectId).', required: true})
    @ApiAcceptedResponse({ description: 'The user has been deleted successfully.',  type: User})
    @ApiNotFoundResponse({ description: 'User not found for the provided ID.'})
    @ApiBadRequestResponse({ description: 'Invalid user ID format.'})
    @Delete(':id')
    async deleteUser(@Param('id') id: string) {
        const isValid = mongoose.Types.ObjectId.isValid(id);
        if (!isValid) throw new BadRequestException('Invalid User ID format.');
        
        const user = await this.userService.deleteUserById(id);
        if (!user) throw new NotFoundException('User not found.');
        return user;
    }
}
