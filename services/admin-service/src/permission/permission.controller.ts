import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseInterceptors,
} from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';

import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionService } from './permission.service';
import { PermissionDescription } from '../swagger/swagger-summary';
import { Auth } from '@netapp-cloud-datamigrate/auth-lib';
import { UserPermissionResponse } from '../auth/user-permission-response-type';
import { NonEmptyStringPipe } from '../utils/pipes/non-empty-string';

@ApiTags('permissions')
@Controller('/api/v1/permission')
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  @Auth()
  @ApiBearerAuth()
  @Post()
  @ApiBody({ type: CreatePermissionDto })
  @ApiOperation({
    summary: 'Create Permission',
    description: PermissionDescription.CreatePermissionDescription,
  })
  create(
    @Body() createPermissionDto: CreatePermissionDto,
    @Request() userPermissionResponse: UserPermissionResponse,
  ) {
    return this.permissionService.create(
      createPermissionDto,
      userPermissionResponse,
    );
  }

  @Auth()
  @ApiBearerAuth()
  @Get()
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(10000)
  @ApiOperation({
    summary: 'Retrieve All Permissions',
    description: PermissionDescription.GetAllPermissionsDescription,
  })
  findAll() {
    return this.permissionService.findAll();
  }

  @Auth()
  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({
    summary: 'Retrieve Permission by ID',
    description: PermissionDescription.GetPermissionByIdDescription,
  })
  findOne(@Param('id', NonEmptyStringPipe) id: string) {
    return this.permissionService.findOne(id);
  }

  @Auth()
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({
    summary: 'Update Permission',
    description: PermissionDescription.UpdatePermissionDescription,
  })
  update(
    @Param('id', NonEmptyStringPipe) id: string,
    @Body() updatePermissionDto: UpdatePermissionDto,
    @Request() userPermissionResponse: UserPermissionResponse,
  ) {
    return this.permissionService.update(
      id,
      updatePermissionDto,
      userPermissionResponse,
    );
  }

  @Auth()
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete Permission',
    description: PermissionDescription.DeletePermissionDescription,
  })
  delete(@Param('id', NonEmptyStringPipe) id: string) {
    return this.permissionService.delete(id);
  }

  @Auth()
  @ApiBearerAuth()
  @Patch(':id/inactivate')
  @ApiOperation({
    summary: 'Inactivate Permission',
    description: PermissionDescription.InactivatePermissionDescription,
  })
  inactivate(@Param('id', NonEmptyStringPipe) id: string) {
    return this.permissionService.inactivate(id);
  }
}
