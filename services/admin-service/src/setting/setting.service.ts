import {
  HttpException,
  HttpStatus,
  Injectable,
  Inject,
} from '@nestjs/common';
import { CreateSettingDto } from './dto/create-setting.dto';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Transporter } from 'nodemailer';
import * as nodemailer from 'nodemailer';
import {
  LoggerFactory,
  LoggerService,
} from '@netapp-cloud-datamigrate/logger-lib';

@Injectable()
export class SettingService {
  private readonly logger: LoggerService;
  constructor(
    @InjectRepository(GlobalSettings)
    private settingsRepo: Repository<GlobalSettings>,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(SettingService.name);
  }
  async create(createSettingDto: CreateSettingDto[]) {
    try {
      if (
        createSettingDto.length > 0 &&
        createSettingDto.some((setting) => setting.settingType === 'SMTP')
      ) {
        const isSMTPConnectionSuccessful =
          await this.testSMTPConnection(createSettingDto);
        console.log('isSMTPConnectionSuccessful:', isSMTPConnectionSuccessful);
        if (!isSMTPConnectionSuccessful) {
          throw new HttpException(
            {
              message: 'SMTP connection test failed',
              statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            },
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
      }

      const createdSettings = await Promise.all(
        createSettingDto.map(async (setting) => {
          const existingSetting = await this.settingsRepo.find({
            where: { settingKey: setting.settingKey },
          });
          if (existingSetting.length > 0) {
            throw new HttpException(
              {
                message: `Setting with key ${setting.settingKey} already exists`,
                statusCode: HttpStatus.BAD_REQUEST,
              },
              HttpStatus.BAD_REQUEST,
            );
          }
          const settingEntity = this.settingsRepo.create(setting);
          return await this.settingsRepo.save(settingEntity);
        }),
      );

      return {
        message: 'SMTP details added successfully.',
        statusCode: HttpStatus.CREATED,
      };
    } catch (error) {
      throw new HttpException(
        {
          message: 'SMTP server is not reachable',
          error: error.message,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
  async testSMTPConnection(
    createSettingDto: CreateSettingDto[],
  ): Promise<boolean> {
    let isVerificationSuccessful: boolean = false;
    const smtpConfig: any = {
      host: createSettingDto.find(
        (setting) => setting.settingKey === 'SMTP_HOST',
      ).settingValue,
      port: createSettingDto.find(
        (setting) => setting.settingKey === 'SMTP_PORT',
      ).settingValue,
      secure: false,
    };
    if (
      createSettingDto.find(
        (setting) => setting.settingKey === 'SMTP_USER_NAME',
      )?.settingValue &&
      createSettingDto.find((setting) => setting.settingKey === 'SMTP_PASSWORD')
        ?.settingValue
    ) {
      smtpConfig.auth = {
        user: createSettingDto.find(
          (setting) => setting.settingKey === 'SMTP_USER_NAME',
        )?.settingValue,
        pass: createSettingDto.find(
          (setting) => setting.settingKey === 'SMTP_PASSWORD',
        )?.settingValue,
      };
    }
    try {
      const transporter: Transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: parseInt(smtpConfig.port),
        secure: smtpConfig.secure,
        auth: smtpConfig.auth
          ? {
              user: smtpConfig.auth.user,
              pass: smtpConfig.auth.pass,
            }
          : undefined,
        socketTimeout: 5000,
        connectionTimeout: 5000,
      });
      await transporter.verify();
      isVerificationSuccessful = true;
    } catch (error) {
      console.error('SMTP Connection Failed:', error);
    }
    return isVerificationSuccessful;
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
  async updateSetting(updateSettingDto: CreateSettingDto[]) {
    try {
      for (const settingObj of updateSettingDto) {
        const setting = await this.settingsRepo.findOne({
          where: { settingKey: settingObj.settingKey },
        });
        if (!setting) {
          throw new HttpException(
            {
              message: `Setting with key ${settingObj.settingKey} not found`,
              statusCode: HttpStatus.NOT_FOUND,
            },
            HttpStatus.NOT_FOUND,
          );
        }
        setting.settingValue = settingObj.settingValue;
        setting.description = settingObj.description;
        await this.settingsRepo.save(setting);
      }
      return {
        message: 'Setting updated successfully',
        statusCode: HttpStatus.OK,
      };
    } catch (error) {
      throw new HttpException(
        {
          message: 'Error updating setting',
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
