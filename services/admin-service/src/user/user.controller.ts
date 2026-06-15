import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { UserDescriptions } from '../swagger/swagger-summary';
import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import { UserPermissionResponse } from '../auth/user-permission-response-type';
import { NonEmptyStringPipe } from '../utils/pipes/non-empty-string';

@ApiTags('users')
@Controller('/api/v1/users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Auth(Permission.InviteUser, Permission.CreateUser)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({
    summary: 'Create a new User',
    description: UserDescriptions.CreateUsersDescription,
  })
  create(
    @Body() createUserDto: CreateUserDto,
    @Request() getUserPermissions: UserPermissionResponse,
  ) {
    return this.userService.create(createUserDto, getUserPermissions);
  }

  @Auth(Permission.ListUsers)
  @ApiBearerAuth()
  @Get()
  @ApiOperation({
    summary: 'Get a paginated list of Users',
    description: UserDescriptions.GetAllUsers,
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of items per page',
  })
  @ApiQuery({
    name: 'sortField',
    required: false,
    type: String,
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: ['ASC', 'DESC'],
    description: 'Sort order',
  })
  @ApiQuery({
    name: 'filter',
    required: false,
    type: String,
    description: 'Filter conditions as JSON string',
  })
  @ApiQuery({
    name: 'projectId',
    required: false,
    type: String,
    description: 'Project ID to filter users by project association',
  })
  findAll(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('sortField') sortField: string = 'id',
    @Query('sortOrder') sortOrder: 'ASC' | 'DESC' = 'ASC',
    @Query('filter') filter: string = '{}',
    @Query('projectId') projectId?: string,
  ) {
    let parsedFilter: Partial<CreateUserDto> = {};
    try {
      const parsed = JSON.parse(filter);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parsedFilter = parsed;
      }
    } catch {
      throw new BadRequestException('Invalid filter JSON');
    }
    return this.userService.findAll(
      page,
      limit,
      sortField,
      sortOrder,
      parsedFilter,
      projectId,
    );
  }

  @Auth()
  @ApiBearerAuth()
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

  @Auth(Permission.ListUsers)
  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({
    summary: 'Get User by ID',
    description: UserDescriptions.GetUserById,
  })
  findOne(@Param('id', NonEmptyStringPipe) id: string) {
    return this.userService.findOne(id);
  }

  @Auth(Permission.UpdateUser)
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({
    summary: 'Update User by ID',
    description: UserDescriptions.UpdateUserById,
  })
  update(
    @Param('id', NonEmptyStringPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Request() userPermissions: UserPermissionResponse,
  ) {
    return this.userService.update(id, updateUserDto, userPermissions);
  }

  @Auth(Permission.DeleteUser)
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete User by ID',
    description: UserDescriptions.DeleteUserById,
  })
  delete(@Param('id', NonEmptyStringPipe) id: string) {
    return this.userService.delete(id);
  }

  @Auth(Permission.UpdateUser)
  @ApiBearerAuth()
  @Patch(':id/inactivate')
  @ApiOperation({
    summary: 'Inactivate User By Id',
    description: UserDescriptions.InactivateUserById,
  })
  inactivate(@Param('id', NonEmptyStringPipe) id: string) {
    return this.userService.inactivate(id);
  }
}
