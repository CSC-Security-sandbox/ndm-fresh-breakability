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
import { Request as ExpressRequest } from 'express';
import { UserRoleService } from './user-role.service';
import { CreateUserRoleDto } from './dto/create-user-role.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UserRole } from '../entities/user-role.entity';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { UserRoleDescription } from '../swagger/swagger-summary';
import { UserRoleRelationDto } from './dto/user-role.dto';
import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import { UserPermissionResponse } from '../auth/user-permission-response-type';
import { NonEmptyStringPipe } from '../utils/pipes/non-empty-string';
import { allowedParamsForUserRolesGetAll } from '../constants/allowed-params';

@ApiTags('user roles')
@Controller('/api/v1/user-roles')
export class UserRoleController {
  constructor(private readonly userRoleService: UserRoleService) {}

  @ApiBearerAuth()
  @Post()
  @ApiOperation({
    summary: 'Create a new user-role association',
    description: UserRoleDescription.CreateUserRoleDescription,
  })
  @ApiBody({ type: CreateUserRoleDto })
  async create(
    @Body() createUserRoleDto: CreateUserRoleDto,
    @Request() userPermissionResponse: UserPermissionResponse,
  ): Promise<UserRole> {
    return this.userRoleService.create(
      createUserRoleDto,
      userPermissionResponse,
    );
  }

  @ApiBearerAuth()
  @Post('/batch')
  @ApiOperation({
    summary: 'Create a new user-role association',
    description: UserRoleDescription.CreateUserRoleDescription,
  })
  @ApiBody({ type: UserRoleRelationDto })
  async batchCreate(
    @Body() userRoleRelationDto: UserRoleRelationDto,
  ): Promise<UserRole[]> {
    return this.userRoleService.batchCreate(userRoleRelationDto);
  }

  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({
    summary: 'Update a user-role association by ID',
    description: UserRoleDescription.UpdateUserRoleDescription,
  })
  async update(
    @Param('id', NonEmptyStringPipe) id: string,
    @Body() updateUserRoleDto: UpdateUserRoleDto,
    @Request() userPermissionResponse: UserPermissionResponse,
  ): Promise<void> {
    await this.userRoleService.update(
      id,
      updateUserRoleDto,
      userPermissionResponse,
    );
  }

  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a user-role association by ID',
    description: UserRoleDescription.DeleteUserRoleDescription,
  })
  async delete(@Param('id', NonEmptyStringPipe) id: string): Promise<void> {
    await this.userRoleService.delete(id);
  }

  @Auth(Permission.ListUsers)
  @ApiBearerAuth()
  @Get('/grouping')
  @ApiOperation({
    summary: 'Get a paginated list of user-role associations',
    description: UserRoleDescription.GetAllUserAndTheirRolesDescription,
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
    name: 'user_id',
    required: false,
    type: String,
    description: 'User ID',
  })
  async fetchUsersAndRoles(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('sortField') sortField: string = 'id',
    @Query('sortOrder') sortOrder: 'ASC' | 'DESC' = 'ASC',
    @Query('user_id') user_id?: string,
  ) {
    const filter: Partial<CreateUserRoleDto> = {
      user_id,
    };
    return this.userRoleService.fetchUsersAndRoles(
      page,
      limit,
      sortField,
      sortOrder,
      filter,
    );
  }

  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({
    summary: 'Get a user-role association by ID',
    description: UserRoleDescription.GetUserRoleByIdDescription,
  })
  async findOne(
    @Param('id', NonEmptyStringPipe) id: string,
  ): Promise<UserRole> {
    return this.userRoleService.findOne(id);
  }

  @Auth(Permission.ListUsers)
  @ApiBearerAuth()
  @Get()
  @ApiOperation({
    summary: 'Get a paginated list of user-role associations',
    description: UserRoleDescription.GetAllUserRolesDescription,
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
    description: 'Filter conditions',
  })
  @ApiQuery({
    name: 'user_id',
    required: false,
    type: String,
    description: 'User ID',
  })
  @ApiQuery({
    name: 'role_id',
    required: false,
    type: String,
    description: 'Role ID',
  })
  @ApiQuery({
    name: 'project_id',
    required: false,
    type: String,
    description: 'Project ID',
  })
  @ApiQuery({
    name: 'account_id',
    required: false,
    type: String,
    description: 'Account ID',
  })
  async findAll(
    @Request() req: ExpressRequest,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('sortField') sortField: string = 'id',
    @Query('sortOrder') sortOrder: 'ASC' | 'DESC' = 'ASC',
    @Query('user_id') user_id?: string,
    @Query('role_id') role_id?: string,
    @Query('project_id') project_id?: string,
    @Query('account_id') account_id?: string,
  ): Promise<UserRole[]> {

    const unexpected = Object.keys(req.query).filter(
      key => !allowedParamsForUserRolesGetAll.includes(key),
    );
    if (unexpected.length > 0) {
      throw new BadRequestException(
        `Unexpected query parameters: ${unexpected.join(', ')}`,
      );
    }
    const filter: Partial<CreateUserRoleDto> = {
      user_id,
      role_id,
      project_id,
      account_id,
    };
    return this.userRoleService.findAll(
      page,
      limit,
      sortField,
      sortOrder,
      filter,
    );
  }
}

