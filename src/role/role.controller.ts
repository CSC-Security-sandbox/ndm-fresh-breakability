import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { RoleService } from './role.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleDescription } from '../swagger/swagger-summary';

@ApiTags('roles')
@Controller('/api/v1/roles')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new Role',
    description: RoleDescription.CreateRoleDescription,
  })
  @ApiBody({ type: CreateRoleDto })
  create(@Body() createRoleDto: CreateRoleDto) {
    return this.roleService.create(createRoleDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get a paginated list of Roles',
    description: RoleDescription.GetAllRolesDescription,
  })
  findAll() {
    return this.roleService.findAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get Role by ID',
    description: RoleDescription.GetRoleByIdDescription,
  })
  findOne(@Param('id') id: string) {
    return this.roleService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update Role by ID',
    description: RoleDescription.UpdateRoleDescription,
  })
  update(@Param('id') id: string, @Body() updateRoleDto: UpdateRoleDto) {
    return this.roleService.update(id, updateRoleDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete Role by ID',
    description: RoleDescription.DeleteRoleDescription,
  })
  delete(@Param('id') id: string) {
    return this.roleService.delete(id);
  }

  @Patch(':id/inactivate')
  @ApiOperation({
    summary: 'Inactivate Role',
    description: RoleDescription.InactivateRoleDescription,
  })
  inactivate(@Param('id') id: string) {
    return this.roleService.inactivate(id);
  }
}
