import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, Post, Put, Query, Request, ValidationPipe } from "@nestjs/common";
import { ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Auth, Permission } from "@netapp-cloud-datamigrate/auth-lib";
import { ConfigurationService } from "./configuration.service";
import { UserDetails } from "./configuration.types";
import { ConfigDTO, FetchCertificateRequestDTO, FetchCertificateResponseDTO, FetchZonesRequestDTO, FetchZonesResponseDTO, ManagementServerDTO } from "./dto/config.dto";
import { ConfigResponseDto, FindAllConfigPageDto, FileServerInfo} from "./dto/findallconfig.dto";
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
        @Request() userDetails: UserDetails,
        @Headers('projectId') projectId?: string,
    ) {
        return await this.configurationService.createConfiguration(createConfigurationDto, userDetails.user.id, userDetails?.trackId, projectId)
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

    @ApiOperation({ summary: 'Get list of File servers For speed test',  description: 'Returns a list of File servers'})
    @ApiOkResponse({ description: 'The list of File servers has been retrieved successfully.',  type: [FileServerInfo]})
    @ApiBadRequestResponse({
        description: 'Invalid pagination parameters.'
    })
    @ApiBearerAuth()
    @Auth(Permission.ViewConfig)
    @Get('/file-servers')
    async getFileServers() {
        return await this.configurationService.getAllFileServers();
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

    @ApiQuery({ name: 'projectId', type: 'string', required: true })
    @ApiQuery({ name: 'configName', type: 'string', required: true })
    @ApiResponse({ status: 200, description: 'Returns true if unique config name' })
    @ApiResponse({ status: 400, description: 'Config name already exists' })
    @ApiResponse({ status: 404, description: 'Project ID not found' })
    @ApiBearerAuth()
    @Auth(Permission.ManageConfig)
    @Get('/check-unique')
    async isConfigNameUnique(
        @Query('projectId') projectId: string,
        @Query('configName') configName: string,
    ): Promise<{ isUnique: boolean }> {
        return await this.configurationService.isConfigNameUnique(projectId, configName);
    }

    @ApiOperation({ summary: 'Get Updated list of exports/shared paths' }) 
    @ApiResponse({ status: 200, description: 'Request created successfully' })
    @Auth(Permission.ManageConfig)
    @Get('/refresh/:id')
    async refreshConfig(@Param('id') id: string ,  @Request() userDetails: UserDetails) {
        return await this.configurationService.refreshConfig(id, userDetails?.trackId)
    }

    // ==================== TLS Certificate API ==================== //

    @ApiOperation({ 
        summary: 'Fetch TLS Certificate from Isilon Management Console',
        description: 'Fetches the self-signed TLS certificate from an Isilon/PowerScale management console. Returns the certificate in PEM format for use in subsequent API calls.'
    })
    @ApiOkResponse({ 
        description: 'Certificate fetched successfully', 
        type: FetchCertificateResponseDTO 
    })
    @ApiBadRequestResponse({ 
        description: 'Invalid host or connection failed' 
    })
    @ApiQuery({ 
        name: 'host',
        type: String,
        description: 'Host address with optional port (e.g., "10.192.7.32" or "10.192.7.32:8080")',
        required: true,
        example: '10.192.7.32'
    })
    @ApiBearerAuth()
    @Auth(Permission.ManageConfig)
    @Get('fetch-certificate')
    async fetchCertificate(
        @Query() request: FetchCertificateRequestDTO,
    ): Promise<FetchCertificateResponseDTO> {
        return await this.configurationService.fetchCertificate(request);
    }

    @ApiOperation({ summary: 'Fetch zones from Dell Isilon management server' })
    @ApiBody({ 
        type: FetchZonesRequestDTO,
        description: 'Management server credentials and connection details'
    })
    @ApiResponse({ 
        status: 200, 
        description: 'Successfully fetched zones',
        type: FetchZonesResponseDTO
    })
    @ApiResponse({ status: 400, description: 'Bad Request - Invalid parameters or connection failed' })
    @ApiResponse({ status: 401, description: 'Unauthorized - Invalid credentials' })
    @ApiBearerAuth()
    @Auth(Permission.ManageConfig)
    @Post('fetch-zones')
    async fetchZones(
        @Body() request: FetchZonesRequestDTO,
    ): Promise<FetchZonesResponseDTO> {
        return await this.configurationService.fetchZones(request);
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
        @Request() userDetails: UserDetails,
        @Headers('projectId') projectId?: string,
    ) {
        return await this.configurationService.updateConfiguration(id, updateConfig, userDetails.user.id, userDetails?.trackId, projectId);
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
}