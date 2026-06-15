import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseInterceptors,
} from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { RoleService } from './role.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RoleDescription } from '../swagger/swagger-summary';
import { UserPermissionResponse } from '../auth/user-permission-response-type';
import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import { NonEmptyStringPipe } from '../utils/pipes/non-empty-string';

@ApiTags('roles')
@Controller('/api/v1/roles')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Auth()
  @ApiBearerAuth()
  @Post()
  @ApiOperation({
    summary: 'Create a new Role',
    description: RoleDescription.CreateRoleDescription,
  })
  @ApiBody({ type: CreateRoleDto })
  create(
    @Body() createRoleDto: CreateRoleDto,
    @Request() userPermissionResponse: UserPermissionResponse,
  ) {
    return this.roleService.create(createRoleDto, userPermissionResponse);
  }

  @Auth(Permission.ManageProject)
  @ApiBearerAuth()
  @Get()
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(10000)
  @ApiOperation({
    summary: 'Get a paginated list of Roles',
    description: RoleDescription.GetAllRolesDescription,
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page' })
  findAll(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 100,
  ) {
    return this.roleService.findAll(page, limit);
  }

  @Auth()
  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({
    summary: 'Get Role by ID',
    description: RoleDescription.GetRoleByIdDescription,
  })
  findOne(@Param('id', NonEmptyStringPipe) id: string) {
    return this.roleService.findOne(id);
  }

  @Auth()
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({
    summary: 'Update Role by ID',
    description: RoleDescription.UpdateRoleDescription,
  })
  update(
    @Param('id', NonEmptyStringPipe) id: string,
    @Body() updateRoleDto: UpdateRoleDto,
    @Request() userPermissionResponse: UserPermissionResponse,
  ) {
    return this.roleService.update(id, updateRoleDto, userPermissionResponse);
  }

  @Auth()
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete Role by ID',
    description: RoleDescription.DeleteRoleDescription,
  })
  delete(@Param('id', NonEmptyStringPipe) id: string) {
    return this.roleService.delete(id);
  }

  @Auth()
  @ApiBearerAuth()
  @Patch(':id/inactivate')
  @ApiOperation({
    summary: 'Inactivate Role',
    description: RoleDescription.InactivateRoleDescription,
  })
  inactivate(@Param('id', NonEmptyStringPipe) id: string) {
    return this.roleService.inactivate(id);
  }
}
