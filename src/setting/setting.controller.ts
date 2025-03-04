import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { SettingService } from './setting.service';
import { CreateSettingDto } from './dto/create-setting.dto';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth, Permission } from '@netapp-cloud-datamigrate/auth-lib';

@ApiTags('Global Settings')
@Controller('setting')
export class SettingController {
  constructor(private readonly settingService: SettingService) {}

  @Post()
  @Auth(Permission.ManageProject)
  @ApiBearerAuth()
  @ApiBody({ type: CreateSettingDto, isArray: true })
  @ApiOperation({
    summary: 'Create Account', description: 'Create Global Settings',
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
}
