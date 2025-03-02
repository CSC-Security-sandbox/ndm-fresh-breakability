import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateSettingDto } from './dto/create-setting.dto';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class SettingService {
  constructor(
    @InjectRepository(GlobalSettings)
    private settingsRepo: Repository<GlobalSettings>,
  ) {}
  async create(createSettingDto: CreateSettingDto[]) {
    try {
      const createdSettings = await Promise.all(
        createSettingDto.map(async (setting) => {
          const settingEntity = this.settingsRepo.create(setting);
          return await this.settingsRepo.save(settingEntity);
        }),
      );

      return {
        message: 'Settings created successfully',
        statusCode: HttpStatus.CREATED,
      };
    } catch (error) {
      throw new HttpException(
        {
          message: 'Error while creating settings',
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findAll() {
    try {
      const settings = await this.settingsRepo.find();
      const groupedSettings = settings.reduce((acc, setting) => {
        const type = setting.settingType;
        if (!acc[type]) {
          acc[type] = [];
        }

        acc[type].push({
          id: setting.id,
          settingKey: setting.settingKey,
          settingValue: setting.settingValue,
          description: setting.description,
          settingType: setting.settingType,
        });
        return acc;
      }, {});

      return {
        message: 'Settings retrieved successfully',
        statusCode: HttpStatus.OK,
        data: groupedSettings,
      };
    } catch (error) {
      throw new HttpException(
        {
          message: 'Error retrieving settings',
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findOne(settingType: string) {
    return await this.settingsRepo.find({
      where: { settingType: settingType },
    });
  }
}
