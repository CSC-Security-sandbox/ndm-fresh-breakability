import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Request, ValidationPipe } from "@nestjs/common";
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Auth, Permission } from "@netapp-cloud-datamigrate/auth-lib";
import { ConfigurationService } from "./configuration.service";
import { UserDetails } from "./configuration.types";
import { ConfigDTO } from "./dto/config.dto";
import { ConfigResponseDto, FindAllConfigPageDto } from "./dto/findallconfig.dto";
import { ConfigApiDoc } from "src/swaggerdoc/swagger.doc";

@ApiTags("Configuration")
@Controller('servers')
export class ConfigurationController{
    constructor(
        private configurationService: ConfigurationService,
    ){}

    @ApiOperation({ summary: 'Create Configuration' , description: ConfigApiDoc.CREATE_CONFIG})
    @ApiCreatedResponse({ description: 'Configuration Created Successfully.' })
    
    @ApiBearerAuth()
    @Auth(Permission.ManageConfig)
    @Post('')
    @HttpCode(HttpStatus.CREATED)
    @ApiBody({ description: 'Configuration data', type: ConfigDTO })
    async createConfiguration(
        @Body() createConfigurationDto: ConfigDTO,
        @Request() userDetails: UserDetails
    ) {
        return  await this.configurationService.createConfiguration(createConfigurationDto, userDetails.user.id,userDetails?.trackId)
    }


    @ApiOperation({ summary: 'Get a paginated list of Config',  description: ConfigApiDoc.GET_ALL_CONFIG})
    @ApiOkResponse({ description: 'The list of Config has been retrieved successfully.',  type: ConfigResponseDto})
    @ApiBadRequestResponse({
        description: 'Invalid pagination parameters.'
    })
    @ApiBearerAuth()
    @Auth(Permission.ViewConfig)
    @Get('/')
    async getAllConfiguration(@Query(new ValidationPipe({ transform: false, whitelist: true }))  findAllConfigPageDto: FindAllConfigPageDto) {
        return await this.configurationService.getAllConfig(findAllConfigPageDto);
    }

    @ApiOperation({ summary: 'Get Configuration by ID' , description: ConfigApiDoc.GET_CONFIG_BY_ID})
    @ApiOkResponse({ description: 'Configuration Found' ,  type: ConfigDTO})
    @ApiNotFoundResponse({ description: 'Configuration Not Found' })
    @ApiBearerAuth()
    @Auth(Permission.ViewConfig)
    @Get(':id')
    async getConfiguration(@Param('id') id: string) {
        return await this.configurationService.getConfigById(id)
    }
   
    @ApiOperation({ summary: 'Get Cutover details by configId' })
    @ApiResponse({ status: 200, description: 'Cutover details Found' })
    @ApiNotFoundResponse({ status: 404, description: 'Cutover details Not Found' })
    @ApiBearerAuth()
    @Auth(Permission.ViewConfig)
    @Get('cutover/:configId')
    async getCutoverDetailsByConfigId(@Param('configId') configId: string) {
        return await this.configurationService.getCutoverDetailsByConfigId(configId);
    }

    @Get('check-unique')
    @ApiQuery({ name: 'projectId', type: 'string', required: true })
    @ApiQuery({ name: 'configName', type: 'string', required: true })
    @ApiResponse({ status: 200, description: 'Returns true if unique config name' })
    @ApiResponse({ status: 400, description: 'Config name already exists' })
    @ApiResponse({ status: 404, description: 'Project ID not found' })
    async isConfigNameUnique(
        @Query('projectId') projectId: string,
        @Query('configName') configName: string,
    ): Promise<{ isUnique: boolean }> {
        return await this.configurationService.isConfigNameUnique(projectId, configName);
    }

    @ApiOperation({ summary: 'Update Configuration by ID', description: ConfigApiDoc.UPDATE_CONFIG_ID })
    @ApiOkResponse({ description: 'Configuration Updated Successfully' })
    @ApiNotFoundResponse({ description: 'Configuration Not Found' })
    @ApiBody({ description: 'Configuration data to update', type: ConfigDTO })
    @ApiBearerAuth()
    @Auth(Permission.ManageConfig)
    @Put(':id')
    async update(
        @Param('id') id: string,
        @Body() updateConfig: ConfigDTO,
        @Request() userDetails: UserDetails
    ) {
        return await this.configurationService.updateConfiguration(id,updateConfig, userDetails.user.id, userDetails?.trackId)
    }

    @ApiOperation({ summary: 'Delete Configuration by ID' , description: ConfigApiDoc.DELETE_CONFIG_ID})
    @ApiOkResponse({ description: 'Configuration Deleted Successfully' })
    @ApiNotFoundResponse({ description: 'Configuration Not Found' })
    @ApiBearerAuth()
    @Auth(Permission.ManageConfig)
    @Delete(':id')
    async remove(@Param('id') id: string) {
        return await this.configurationService.remove(id);
    }

    @ApiOperation({ summary: 'Get Workflow Result' }) 
    @ApiResponse({ status: 200, description: 'Request created successfully' })
    @Get('/refresh/:id')
    async refreshConfig(@Param('id') id: string,  @Request() userDetails: UserDetails) {
        return await this.configurationService.refreshConfig(id, userDetails?.trackId)
    }

}