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
import { RolePermissionService } from './role-permission.service';
import { CreateRolePermissionDto } from './dto/create-role-permission.dto';
import { UpdateRolePermissionDto } from './dto/update-role-permission.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { RolePermissionDescription } from '../swagger/swagger-summary';
import { Auth } from '@netapp-cloud-datamigrate/auth-lib';
import { UserPermissionResponse } from '../auth/user-permission-response-type';
import { NonEmptyStringPipe } from '../utils/pipes/non-empty-string';

@ApiTags('role-permissions')
@Controller('/api/v1/role-permissions')
export class RolePermissionController {
  constructor(private readonly rolePermissionService: RolePermissionService) {}

  @Auth()
  @ApiBearerAuth()
  @Post()
  @ApiOperation({
    summary: 'Create a new role-permission association',
    description: RolePermissionDescription.CreateRolePermissionDescription,
  })
  @ApiBody({ type: CreateRolePermissionDto })
  create(
    @Body() createRolePermissionDto: CreateRolePermissionDto,
    @Request() userPermissionResponse: UserPermissionResponse,
  ) {
    return this.rolePermissionService.create(
      createRolePermissionDto.role_id,
      createRolePermissionDto,
      userPermissionResponse,
    );
  }

  @Auth()
  @ApiBearerAuth()
  @Get()
  @ApiOperation({
    summary: 'Get a paginated list of role-permission associations',
    description: RolePermissionDescription.GetAllRolePermissionsDescription,
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
  findAll(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
    @Query('sortField') sortField: string = 'id',
    @Query('sortOrder') sortOrder: 'ASC' | 'DESC' = 'ASC',
    @Query('filter') filter: string,
  ) {
    let parsedFilter = {};
    if (filter != null) {
      try {
        parsedFilter = JSON.parse(filter);
      } catch {
        throw new BadRequestException('Invalid filter JSON');
      }
    }
    return this.rolePermissionService.findAll(
      page,
      limit,
      sortField,
      sortOrder,
      parsedFilter,
    );
  }

  @Auth()
  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({
    summary: 'Get a role-permission association by ID',
    description: RolePermissionDescription.GetRolePermissionByIdDescription,
  })
  findOne(@Param('id', NonEmptyStringPipe) id: string) {
    return this.rolePermissionService.findOne(id);
  }

  @Auth()
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({
    summary: 'Update a role-permission association by ID',
    description: RolePermissionDescription.UpdateRolePermissionDescription,
  })
  update(
    @Param('id', NonEmptyStringPipe) id: string,
    @Body() updateRolePermissionDto: UpdateRolePermissionDto,
  ) {
    return this.rolePermissionService.update(id, updateRolePermissionDto);
  }

  @Auth()
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a role-permission association by ID',
    description: RolePermissionDescription.DeleteRolePermissionDescription,
  })
  delete(@Param('id', NonEmptyStringPipe) id: string) {
    return this.rolePermissionService.delete(id);
  }
}
