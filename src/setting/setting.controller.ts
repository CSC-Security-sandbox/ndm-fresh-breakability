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
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Global Settings')
@Controller('setting')
export class SettingController {
  constructor(private readonly settingService: SettingService) {}

  @Post()
  @ApiBody({ type: CreateSettingDto, isArray: true })
  @ApiOperation({
    summary: 'Create Account', description: 'Create Global Settings',
  })
  async create(@Body() createSettingDto: CreateSettingDto[]) {
    return await this.settingService.create(createSettingDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get All Global Settings',
    description: 'Get all global settings',
  })
  async findAll() {
    return await this.settingService.findAll();
  }

  @Get(':settingType')
  @ApiOperation({
    summary: 'Get Global Setting',
    description: 'Get a global setting by setting type',
  })
  async findOne(@Param('settingType') settingType: string) {
    return await this.settingService.findOne(settingType);
  }
}
