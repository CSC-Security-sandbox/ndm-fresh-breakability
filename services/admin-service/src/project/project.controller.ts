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
} from '@nestjs/common';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ProjectDescriptions } from '../swagger/swagger-summary';
import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import { UserPermissionResponse } from '../auth/user-permission-response-type';
import { NonEmptyStringPipe } from '../utils/pipes/non-empty-string';

@ApiTags('projects')
@Controller('/api/v1/projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Auth(Permission.CreateProject)
  @ApiBearerAuth()
  @Post()
  @ApiOperation({
    summary: 'Create Project',
    description: ProjectDescriptions.CreateProjectsDescription,
  })
  @ApiBody({ type: CreateProjectDto })
  create(
    @Body() createProjectDto: CreateProjectDto,
    @Request() userPermissionResponse: UserPermissionResponse,
  ) {
    return this.projectService.create(
      createProjectDto.account_id,
      createProjectDto,
      userPermissionResponse,
    );
  }

  @Auth()
  @ApiBearerAuth()
  @Get()
  @ApiOperation({
    summary: 'Get Page of Project List',
    description: ProjectDescriptions.GetAllProjects,
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
    return this.projectService.findAll(
      page,
      limit,
      sortField,
      sortOrder,
      filter != null ? JSON.parse(filter) : {},
    );
  }

  @Auth()
  @ApiBearerAuth()
  @Get('/accounts/:account_id/projects')
  @ApiOperation({
    summary: 'Get Project By Account Id',
    description: ProjectDescriptions.GetProjectsByAccountId,
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
  @Get('/accounts/:account_id/projects')
  findByAccountId(
    @Request() userPermissionResponse: UserPermissionResponse,
    @Param('account_id') account_id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('sortField') sortField?: string,
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
    @Query('filter') filter?: string,
  ) {
    return this.projectService.findByAccount(
      account_id,
      page,
      limit,
      sortField,
      sortOrder,
      filter != null ? JSON.parse(filter) : {},
      userPermissionResponse,
    );
  }

  @ApiBearerAuth()
  @Get(':id')
  @ApiOperation({
    summary: 'Get Project by project id',
    description: ProjectDescriptions.GetProjectById,
  })
  findOne(@Param('id', NonEmptyStringPipe) id: string) {
    return this.projectService.findOne(id);
  }

  @Auth(Permission.UpdateProject)
  @ApiBearerAuth()
  @Patch(':id')
  @ApiOperation({
    summary: 'Update Project',
    description: ProjectDescriptions.UpdateProjectById,
  })
  update(
    @Param('id', NonEmptyStringPipe) id: string,
    @Body() updateProjectDto: UpdateProjectDto,
    @Request() userPermissionResponse: UserPermissionResponse,
  ) {
    return this.projectService.update(
      id,
      updateProjectDto,
      userPermissionResponse,
    );
  }

  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete Project',
    description: ProjectDescriptions.DeleteProjectById,
  })
  delete(@Param('id', NonEmptyStringPipe) id: string) {
    return this.projectService.delete(id);
  }
}
