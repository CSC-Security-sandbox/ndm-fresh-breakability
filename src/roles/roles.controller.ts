import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { RolesService } from './roles.service';
import { ApiAcceptedResponse, ApiBadRequestResponse, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CreateRoleDTO } from './dto/createrole.dto';
import { Role } from 'src/schemas/Role.schema';
import { RolePagenDTO } from './dto/rolespage.dto';
import mongoose from 'mongoose';
import { UpdateRoleDTO } from './dto/updaterole.dto';


@ApiTags("Role")
@Controller('roles')
export class RolesController {
    constructor(private roleService: RolesService) {}

    @ApiOperation({ summary: 'Create a new Role', description: 'Creates a Role in the database and returns the newly created Role object.'})
    @ApiCreatedResponse({ description: 'Role has been created successfully.', type: Role })
    @ApiBadRequestResponse({  description: 'Invalid input data. Check the provided Role information.'})
    @Post()
    createRole(@Body() createRoleDTO: CreateRoleDTO) {
        return this.roleService.createRole(createRoleDTO);   
    }

    @ApiOperation({ summary: 'Get a paginated list of Roles',  description: 'Returns a list of Roles based on the provided pagination parameters.'})
    @ApiOkResponse({ description: 'The list of Roles has been retrieved successfully.',  type: [Role] })
    @ApiBadRequestResponse({
        description: 'Invalid pagination parameters.'
    })
    @Post('/all')
    async getRoles(@Body() RolePagenDTO: RolePagenDTO) {
        return await this.roleService.findAllRole(RolePagenDTO);
    }

    @ApiOperation({ summary: 'Get Role by ID', description: 'Fetches a Role by their unique Role ID.' })
    @ApiParam({ name: 'id', description: 'The unique identifier of the Role (MongoDB ObjectId).', required: true })
    @ApiOkResponse({ description: 'The Role has been found successfully.', type: Role })
    @ApiNotFoundResponse({ description: 'Role not found for the provided ID.' })
    @ApiBadRequestResponse({ description: 'Invalid Role ID format. Must be a valid MongoDB ObjectId.' })
    @Get(':id')
    async getRolesById(@Param('id') id: string) {
        const isValid = mongoose.Types.ObjectId.isValid(id);
        if (!isValid) throw new BadRequestException('Invalid Role ID format.');
        
        const Role = await this.roleService.findRoleById(id);
        if (!Role) throw new NotFoundException('Role not found.');
        return Role;
    }

    @ApiOperation({ summary: 'Update Role by ID', description: 'Updates the details of an existing Role using their unique ID.'})
    @ApiParam({name: 'id', description: 'The unique identifier of the Role (MongoDB ObjectId).',required: true})
    @ApiOkResponse({description: 'The Role has been updated successfully.', type: Role})
    @ApiNotFoundResponse({description: 'Role not found for the provided ID.'})
    @ApiBadRequestResponse({description: 'Invalid Role ID format or invalid input data.'})
    @Patch(':id')
    async updateRole(@Param('id') id: string, @Body() updateRoleDTO: UpdateRoleDTO) {
        const isValid = mongoose.Types.ObjectId.isValid(id);
        if (!isValid) throw new BadRequestException('Invalid Role ID format.');
        
        const Role = await this.roleService.updateRoleById(id, updateRoleDTO);
        if (!Role) throw new NotFoundException('Role not found.');
        return Role;
    }

    @ApiOperation({ summary: 'Delete Role by ID',  description: 'Deletes an existing Role using their unique ID.'})
    @ApiParam({ name: 'id',  description: 'The unique identifier of the Role (MongoDB ObjectId).', required: true})
    @ApiAcceptedResponse({ description: 'The Role has been deleted successfully.',  type: Role})
    @ApiNotFoundResponse({ description: 'Role not found for the provided ID.'})
    @ApiBadRequestResponse({ description: 'Invalid Role ID format.'})
    @Delete(':id')
    async deleteRole(@Param('id') id: string) {
        const isValid = mongoose.Types.ObjectId.isValid(id);
        if (!isValid) throw new BadRequestException('Invalid Role ID format.');
        
        const Role = await this.roleService.deleteRoleById(id);
        if (!Role) throw new NotFoundException('Role not found.');
        return Role;
    }
}
