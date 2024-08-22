import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import mongoose from 'mongoose';
import { Project } from 'src/schemas/Project.schema';
import { CreateProjectDTO } from './dto/createproject.dto';
import { ProjectPageDTO } from './dto/projectpage.dto';
import { UpdatedProjectDTO } from './dto/updateproject.dto';

@ApiTags("Projects")
@Controller('projects')
export class ProjectsController {

    constructor(private projectsService: ProjectsService){}

    @ApiOperation({summary: 'Create Project', description:'Api will create User and return the user object'})
    @ApiCreatedResponse({description: 'Project Created Succesfully.', type: Project})
    @Post()
    createUser(@Body() createProjectDTO: CreateProjectDTO) {
        return this.projectsService.createProject(createProjectDTO)   
    }

    @ApiOperation({summary: 'Get Page of Project List'})
    @ApiOkResponse({description: 'ok', type:[Project]})
    @Post('/all')
    async getUsers(@Body() projectPageDTO: ProjectPageDTO) {
        return await this.projectsService.findAllProject(projectPageDTO)
    }

    @ApiOperation({summary: 'Get Project by userId'})
    @ApiOkResponse({description: 'ok', type:Project})
    @Get(':id')
    async getUsersById(@Param('id') id: string) {
        const isValid = mongoose.Types.ObjectId.isValid(id);
        if(!isValid) throw new BadRequestException('ProjectId Is Invalid.')
        const user = await this.projectsService.findProjectById(id);
        if(!user) throw new NotFoundException('Project Not Found.')
        return user
    }

    @ApiOperation({summary: 'Update Project'})
    @ApiOkResponse({description: 'ok', type:Project})
    @Patch(':id')
    async updateUser(@Param('id') id: string, @Body() updatedProjectDTO: UpdatedProjectDTO){
        const isValid = mongoose.Types.ObjectId.isValid(id);
        if(!isValid) throw new BadRequestException('ProjectId Is Invalid.')
        const user = await this.projectsService.updateProjectById(id, updatedProjectDTO);
        if(!user) throw new NotFoundException('Project Not Found.')
        return user
    }

    @ApiOperation({summary: 'Delete User'})
    @ApiAcceptedResponse({description: 'ok', type:Project})
    @Delete(":id")
    async deleteUser(@Param('id') id: string) {
        const isValid = mongoose.Types.ObjectId.isValid(id);
        if(!isValid) throw new BadRequestException('ProjectId Is Invalid.')
        const user = await this.projectsService.deleteProjectById(id);
        if(!user) throw new NotFoundException('Project Not Found.')
        return user
    }

}
