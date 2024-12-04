import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { RolePermissionService } from './role-permission.service';
import { CreateRolePermissionDto } from './dto/create-role-permission.dto';
import { UpdateRolePermissionDto } from './dto/update-role-permission.dto';
import { ApiBody, ApiQuery, ApiTags, ApiOperation } from '@nestjs/swagger';
import { RolePermissionDescription } from '../swagger/swagger-summary';

@ApiTags('role-permissions')
@Controller('/api/v1/role-permissions')
export class RolePermissionController {
  constructor(private readonly rolePermissionService: RolePermissionService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new role-permission association',
    description: RolePermissionDescription.CreateRolePermissionDescription,
  })
  @ApiBody({ type: CreateRolePermissionDto })
  create(@Body() createRolePermissionDto: CreateRolePermissionDto) {
    return this.rolePermissionService.create(
      createRolePermissionDto.role_id,
      createRolePermissionDto,
    );
  }

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
    return this.rolePermissionService.findAll(
      page,
      limit,
      sortField,
      sortOrder,
      filter != null ? JSON.parse(filter) : {},
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a role-permission association by ID',
    description: RolePermissionDescription.GetRolePermissionByIdDescription,
  })
  findOne(@Param('id') id: string) {
    return this.rolePermissionService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a role-permission association by ID',
    description: RolePermissionDescription.UpdateRolePermissionDescription,
  })
  update(
    @Param('id') id: string,
    @Body() updateRolePermissionDto: UpdateRolePermissionDto,
  ) {
    return this.rolePermissionService.update(id, updateRolePermissionDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a role-permission association by ID',
    description: RolePermissionDescription.DeleteRolePermissionDescription,
  })
  delete(@Param('id') id: string) {
    return this.rolePermissionService.delete(id);
  }
}
