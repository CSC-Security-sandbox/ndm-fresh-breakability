import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete
} from '@nestjs/common';

import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { ApiBody, ApiTags, ApiOperation } from '@nestjs/swagger';
import { PermissionService } from './permission.service';
import { PermissionDescription } from '../swagger/swagger-summary';

@ApiTags('permissions')
@Controller('/api/v1/permission')
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  @Post()
  @ApiBody({ type: CreatePermissionDto })
  @ApiOperation({
    summary: 'Create Permission',
    description: PermissionDescription.CreatePermissionDescription,
  })
  create(@Body() createPermissionDto: CreatePermissionDto) {
    return this.permissionService.create(createPermissionDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Retrieve All Permissions',
    description: PermissionDescription.GetAllPermissionsDescription,
  })
  findAll() {
    return this.permissionService.findAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Retrieve Permission by ID',
    description: PermissionDescription.GetPermissionByIdDescription,
  })
  findOne(@Param('id') id: string) {
    return this.permissionService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update Permission',
    description: PermissionDescription.UpdatePermissionDescription,
  })
  update(
    @Param('id') id: string,
    @Body() updatePermissionDto: UpdatePermissionDto,
  ) {
    return this.permissionService.update(id, updatePermissionDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete Permission',
    description: PermissionDescription.DeletePermissionDescription,
  })
  delete(@Param('id') id: string) {
    return this.permissionService.delete(id);
  }

  @Patch(':id/inactivate')
  @ApiOperation({
    summary: 'Inactivate Permission',
    description: PermissionDescription.InactivatePermissionDescription,
  })
  inactivate(@Param('id') id: string) {
    return this.permissionService.inactivate(id);
  }
}
