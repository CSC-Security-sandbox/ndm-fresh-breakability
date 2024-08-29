import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Logger, NotFoundException, Param, Post, Put } from "@nestjs/common";
import { ApiBody, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Types } from "mongoose";
import { ConfigurationService } from "./configuration.service";
import { CreateConfigurationDto } from "./dto/createconfiguration.dto";
import { Configuration } from "../schemas/Configuration.schema";
import { UpdateConfigurationDto } from "./dto/updateConfiguration.dto";

@ApiTags("Configuration")
@Controller('configuration')
export class ConfigurationController{
    constructor(
        private configurationService: ConfigurationService
    ){}

    @ApiOperation({ summary: 'Create Configuration' })
    @ApiCreatedResponse({ description: 'Configuration Created Successfully.' })
    @Post('')
    @HttpCode(HttpStatus.CREATED)
    @ApiBody({ description: 'Configuration data', type: CreateConfigurationDto })
    async createConfiguration(
        @Body() createConfigurationDto: CreateConfigurationDto
    ): Promise<Configuration> {
        const createdConfiguration = await this.configurationService.createConfiguration(createConfigurationDto);
        return createdConfiguration;
    }


    // @ApiOperation({ summary: 'Get Configuration by ID' })
    // @ApiOkResponse({ description: 'Configuration Found' })
    // @ApiNotFoundResponse({ description: 'Configuration Not Found' })
    // @Get(':id')
    // async getConfiguration(@Param('id') id: string): Promise<Configuration> {
    //     try {
    //         const res = await this.configurationService.findConfiguration({ filter: { _id: id} });
    //         if(!res.length) throw new Error('No Data')
    //         return res[0];
    //     } catch (error) {
    //         throw new NotFoundException(`Configuration with ID ${id} not found`);
    //     }
    // }

    @ApiOperation({ summary: 'Get Configurations by Project ID' })
    @ApiOkResponse({ description: 'List of Configurations for the Project' })
    @Get('project/:projectId')
    async findByProjectId(@Param('projectId') projectId: string): Promise<Configuration[]> {
        return this.configurationService.findConfiguration({
            filter: { projectId: new Types.ObjectId(projectId) }
        });
    }

    @ApiOperation({ summary: 'Update Configuration by ID' })
    @ApiOkResponse({ description: 'Configuration Updated Successfully' })
    @ApiNotFoundResponse({ description: 'Configuration Not Found' })
    @ApiBody({ description: 'Configuration data to update', type: UpdateConfigurationDto })
    @Put(':id')
    async update(
        @Param('id') id: string,
        @Body() updateConfigurationDto: Partial<CreateConfigurationDto>
    ): Promise<Configuration> {
        return this.configurationService.update(new Types.ObjectId(id), updateConfigurationDto);
    }

    @ApiOperation({ summary: 'Delete Configuration by ID' })
    @ApiOkResponse({ description: 'Configuration Deleted Successfully' })
    @ApiNotFoundResponse({ description: 'Configuration Not Found' })
    @Delete(':id')
    async remove(@Param('id') id: string): Promise<{ success: boolean; id: Types.ObjectId; }> {
        return this.configurationService.remove(new Types.ObjectId(id));
    }

    @Get(':id')
    async testApi(@Param('id') id: string) {
        Logger.log(id)
        this.configurationService.send(id)
    }
}