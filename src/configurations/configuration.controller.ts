import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, ValidationPipe } from "@nestjs/common";
import { ApiBadRequestResponse, ApiBody, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ConfigurationService } from "./configuration.service";
import { ConfigResponseDto, FindallConfigPageDto } from "./dto/findallconfig.dto";
import { ConfigDTO } from "./dto/config.dto";

@ApiTags("Configuration")
@Controller('servers')
export class ConfigurationController{
    constructor(
        private configurationService: ConfigurationService
    ){}

    @ApiOperation({ summary: 'Create Configuration' })
    @ApiCreatedResponse({ description: 'Configuration Created Successfully.' })
    @Post('')
    @HttpCode(HttpStatus.CREATED)
    @ApiBody({ description: 'Configuration data', type: ConfigDTO })
    async createConfiguration(
        @Body() createConfigurationDto: ConfigDTO
    ) {
        const createdConfiguration = await this.configurationService.createConfiguration(createConfigurationDto);
        return createdConfiguration;
    }


    @ApiOperation({ summary: 'Get a paginated list of Config',  description: 'Returns a list of Workers based on the provided pagination parameters.'})
    @ApiOkResponse({ description: 'The list of Config has been retrieved successfully.',  type: ConfigResponseDto})
    @ApiBadRequestResponse({
        description: 'Invalid pagination parameters.'
    })
    @Get('/')
    async getAllConfiguration(@Query(new ValidationPipe({ transform: false, whitelist: true }))  findallConfigPageDto: FindallConfigPageDto) {
        return await this.configurationService.getAllConfig(findallConfigPageDto);
    }

    @ApiOperation({ summary: 'Get Configuration by ID' })
    @ApiOkResponse({ description: 'Configuration Found' ,  type: ConfigDTO})
    @ApiNotFoundResponse({ description: 'Configuration Not Found' })
    @Get(':id')
    async getConfiguration(@Param('id') id: string) {
        return await this.configurationService.getConfigById(id)
    }
   

    @ApiOperation({ summary: 'Update Configuration by ID' })
    @ApiOkResponse({ description: 'Configuration Updated Successfully' })
    @ApiNotFoundResponse({ description: 'Configuration Not Found' })
    @ApiBody({ description: 'Configuration data to update', type: ConfigDTO })
    @Put(':id')
    async update(
        @Param('id') id: string,
        @Body() updateConfig: ConfigDTO
    ) {
        return await this.configurationService.updateConfiguration(id,updateConfig);
    }

    @ApiOperation({ summary: 'Delete Configuration by ID' })
    @ApiOkResponse({ description: 'Configuration Deleted Successfully' })
    @ApiNotFoundResponse({ description: 'Configuration Not Found' })
    @Delete(':id')
    async remove(@Param('id') id: string) {
        return await this.configurationService.remove(id);
    }
}