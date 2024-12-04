import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserDescriptions } from '../swagger/swagger-summary';

@ApiTags('users')
@Controller('/api/v1/users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new User',
    description: UserDescriptions.CreateUsersDescription,
  })
  create(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get a paginated list of Users',
    description: UserDescriptions.GetAllUsers,
  })
  findAll() {
    return this.userService.findAll();
  }

  @Get('/permissions')
  @ApiOperation({
    summary: 'Get user permissions according to project',
    description: UserDescriptions.GetUserPermissionsDescription,
  })
  async getUserPermissions(
    @Query('email') email: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.userService.getUserProjectsAndPermissions(email, projectId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get User by ID',
    description: UserDescriptions.GetUserById,
  })
  findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update User by ID',
    description: UserDescriptions.UpdateUserById,
  })
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.userService.update(id, updateUserDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete User by ID',
    description: UserDescriptions.DeleteUserById,
  })
  delete(@Param('id') id: string) {
    return this.userService.delete(id);
  }

  @Patch(':id/inactivate')
  @ApiOperation({
    summary: 'Inactivate User By Id',
    description: UserDescriptions.InactivateUserById,
  })
  inactivate(@Param('id') id: string) {
    return this.userService.inactivate(id);
  }
}
