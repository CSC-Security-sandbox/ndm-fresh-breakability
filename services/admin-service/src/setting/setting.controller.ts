import { Controller, Get, Post, Body, Patch, Param, Inject } from '@nestjs/common';
import { SettingService } from './setting.service';
import { CreateSettingDto } from './dto/create-setting.dto';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';
import { LoggerService, LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

@ApiTags('Global Settings')
@Controller('/api/v1/setting')
export class SettingController {
  private logger: LoggerService;
  constructor(
    private readonly settingService: SettingService,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(SettingController.name);
  }

  @Post()
  @Auth(Permission.ManageProject)
  @ApiBearerAuth()
  @ApiBody({ type: CreateSettingDto, isArray: true })
  @ApiOperation({
    summary: 'Create Account',
    description: 'Create Global Settings',
  })
  async create(@Body() createSettingDto: CreateSettingDto[]) {
    return await this.settingService.create(createSettingDto);
  }

  @Get()
  @Auth(Permission.ManageProject)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get All Global Settings',
    description: 'Get all global settings',
  })
  async findAll() {
    return await this.settingService.findAll();
  }

  @Get(':settingType')
  @Auth(Permission.ManageProject)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get Global Setting',
    description: 'Get a global setting by setting type',
  })
  async findOne(@Param('settingType') settingType: string) {
    return await this.settingService.findOne(settingType);
  }

  @Patch()
  @Auth(Permission.ManageProject)
  @ApiBearerAuth()
  @ApiBody({ type: CreateSettingDto, isArray: true })
  @ApiOperation({
    summary: 'Update Global Settings',
    description: 'Update global settings',
  })
  async updateSetting(@Body() setting: CreateSettingDto[]) {
    return await this.settingService.updateSetting(setting);
  }
}
