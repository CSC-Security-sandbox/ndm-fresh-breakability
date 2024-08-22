import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { AccessrelationService } from './accessrelation.service';
import { ApiAcceptedResponse, ApiBadRequestResponse, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam } from '@nestjs/swagger';
import { AccessRelationDTO } from './dto/accessrelation.dto';
import { AccessRelation } from 'src/schemas/accessrelation.schema';
import mongoose from 'mongoose';

@Controller('accessrelation')
export class AccessrelationController {
    constructor(private accessrelationService: AccessrelationService) {}

    @ApiOperation({ summary: 'Create a new AccessRelation', description: 'Creates a AccessRelation in the database and returns the newly created AccessRelation object.'})
    @ApiCreatedResponse({ description: 'AccessRelation has been created successfully.', type: AccessRelation })
    @ApiBadRequestResponse({  description: 'Invalid input data. Check the provided AccessRelation information.'})
    @Post()
    createRole(@Body() accessRelationDTO: AccessRelationDTO) {
        return this.accessrelationService.createRelation(accessRelationDTO);   
    }

    @ApiOperation({ summary: 'Get a paginated list of Roles',  description: 'Returns a list of Roles based on the provided pagination parameters.'})
    @ApiOkResponse({ description: 'The list of Roles has been retrieved successfully.',  type: [AccessRelation] })
    @ApiBadRequestResponse({
        description: 'Invalid pagination parameters.'
    })
    
    @Post('/all')
    async getRoles() {
        return await this.accessrelationService.findAll();
    }

    @ApiOperation({ summary: 'Get AccessRelation by ID', description: 'Fetches a AccessRelation by their unique AccessRelation ID.' })
    @ApiParam({ name: 'id', description: 'The unique identifier of the AccessRelation (MongoDB ObjectId).', required: true })
    @ApiOkResponse({ description: 'The AccessRelation has been found successfully.', type: AccessRelation })
    @ApiNotFoundResponse({ description: 'AccessRelation not found for the provided ID.' })
    @ApiBadRequestResponse({ description: 'Invalid AccessRelation ID format. Must be a valid MongoDB ObjectId.' })
    @Get(':id')
    async getRolesById(@Param('id') id: string) {
        const isValid = mongoose.Types.ObjectId.isValid(id);
        if (!isValid) throw new BadRequestException('Invalid AccessRelation ID format.');
        
        const AccessRelation = await this.accessrelationService.findRelationsById(id);
        if (!AccessRelation) throw new NotFoundException('AccessRelation not found.');
        return AccessRelation;
    }

    @ApiOperation({ summary: 'Update AccessRelation by ID', description: 'Updates the details of an existing AccessRelation using their unique ID.'})
    @ApiParam({name: 'id', description: 'The unique identifier of the AccessRelation (MongoDB ObjectId).',required: true})
    @ApiOkResponse({description: 'The AccessRelation has been updated successfully.', type: AccessRelation})
    @ApiNotFoundResponse({description: 'AccessRelation not found for the provided ID.'})
    @ApiBadRequestResponse({description: 'Invalid AccessRelation ID format or invalid input data.'})
    @Patch(':id')
    async updateRole(@Param('id') id: string, @Body() accessRelationDTO: AccessRelationDTO) {
        const isValid = mongoose.Types.ObjectId.isValid(id);
        if (!isValid) throw new BadRequestException('Invalid AccessRelation ID format.');
        
        const AccessRelation = await this.accessrelationService.updateRelationsById(id, accessRelationDTO);
        if (!AccessRelation) throw new NotFoundException('AccessRelation not found.');
        return AccessRelation;
    }

    @ApiOperation({ summary: 'Delete AccessRelation by ID',  description: 'Deletes an existing AccessRelation using their unique ID.'})
    @ApiParam({ name: 'id',  description: 'The unique identifier of the AccessRelation (MongoDB ObjectId).', required: true})
    @ApiAcceptedResponse({ description: 'The AccessRelation has been deleted successfully.',  type: AccessRelation})
    @ApiNotFoundResponse({ description: 'AccessRelation not found for the provided ID.'})
    @ApiBadRequestResponse({ description: 'Invalid AccessRelation ID format.'})
    @Delete(':id')
    async deleteRole(@Param('id') id: string) {
        const isValid = mongoose.Types.ObjectId.isValid(id);
        if (!isValid) throw new BadRequestException('Invalid AccessRelation ID format.');
        const AccessRelation = await this.accessrelationService.deleteRelationById(id);
        if (!AccessRelation) throw new NotFoundException('AccessRelation not found.');
        return AccessRelation;
    }
}
