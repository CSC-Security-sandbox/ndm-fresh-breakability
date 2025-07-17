import { HttpException, HttpStatus, Injectable, Inject } from '@nestjs/common';
import { CreateSettingDto } from './dto/create-setting.dto';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Transporter } from 'nodemailer';
import * as nodemailer from 'nodemailer';
import { decryptData } from 'src/utils/crypto-utils';
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

  private async validateSMTPConnection(
    settingsDto: CreateSettingDto[],
  ): Promise<void> {
    if (
      settingsDto.length > 0 &&
      settingsDto.some((setting) => setting.settingType === 'SMTP')
    ) {
      const isSMTPConnectionSuccessful =
        await this.testSMTPConnection(settingsDto);
      this.logger.log(
        `isSMTPConnectionSuccessful: ${isSMTPConnectionSuccessful}`,
      );

      if (!isSMTPConnectionSuccessful) {
        throw new HttpException(
          {
            message: 'SMTP connection test failed',
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            error: 'SMTP connection test failed',
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
  }

  async create(createSettingDto: CreateSettingDto[]) {
    for (const setting of createSettingDto) {
      if (setting.settingKey === 'SMTP_PASSWORD' && setting.settingValue) {
        try {
          setting.settingValue = decryptData(setting.settingValue);
        } catch (error) {
          this.logger.error('Error while retrieving settings', error);
          throw new HttpException(
            {
              message: `Error while retrieving settings: ${error.message}`,
              statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
              error: error.message,
            },
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
      }
    }

    try {
      // Validate SMTP connection
      await this.validateSMTPConnection(createSettingDto);

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
                error: `Setting with key ${setting.settingKey} already exists`,
              },
              HttpStatus.BAD_REQUEST,
            );
          }
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
  async testSMTPConnection(
    createSettingDto: CreateSettingDto[],
  ): Promise<boolean> {
    try {
      this.logger.log('Testing SMTP connection');

      let isVerificationSuccessful: boolean = false;

      const hostSetting = createSettingDto.find(
        (setting) => setting.settingKey === 'SMTP_HOST',
      );
      const portSetting = createSettingDto.find(
        (setting) => setting.settingKey === 'SMTP_PORT',
      );

      if (!hostSetting || !portSetting) {
        this.logger.error('Missing required SMTP configuration (host or port)');
        return false;
      }

      const smtpConfig: any = {
        host: hostSetting.settingValue,
        port: portSetting.settingValue,
        secure: false,
      };

      const userNameSetting = createSettingDto.find(
        (setting) => setting.settingKey === 'SMTP_USER_NAME',
      );
      const passwordSetting = createSettingDto.find(
        (setting) => setting.settingKey === 'SMTP_PASSWORD',
      );

      if (userNameSetting?.settingValue && passwordSetting?.settingValue) {
        smtpConfig.auth = {
          user: userNameSetting.settingValue,
          pass: passwordSetting.settingValue,
        };
      }
      
      let transporter: Transporter | null = null;
      try {
        transporter = nodemailer.createTransport({
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
        this.logger.log('SMTP connection test successful');
      } catch (smtpError) {
        this.logger.error('SMTP Connection Failed', smtpError);
        isVerificationSuccessful = false;
      } finally {
        // Always close transporter to prevent memory leaks
        if (transporter) {
          try {
            transporter.close();
          } catch (closeError) {
            this.logger.error('Error closing SMTP transporter:', closeError.message);
          }
        }
      }
      return isVerificationSuccessful;
    } catch (error) {
      this.logger.error('Error during SMTP connection test', error);
      return false;
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
          // Do not send SMTP_PASSWORD in any response to protect sensitive data.
          settingValue:
            setting.settingKey === 'SMTP_PASSWORD' ? '' : setting.settingValue,
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
      this.logger.error('Error retrieving settings', error);
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
    try {
      return await this.settingsRepo.find({
        where: { settingType: settingType },
      });
    } catch (error) {
      this.logger.error('Error finding settings by type', error);
      throw new HttpException(
        {
          message: 'Error finding settings',
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  async updateSetting(updateSettingDto: CreateSettingDto[]) {
    for (const setting of updateSettingDto) {
      if (setting.settingKey === 'SMTP_PASSWORD' && setting.settingValue) {
        try {
          setting.settingValue = decryptData(setting.settingValue);
        } catch (error) {
          this.logger.error('Error while updating settings', error);
          throw new HttpException(
            {
              message: `Error while updating settings: ${error.message}`,
              statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
              error: error.message,
            },
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
      }
    }

    try {
      // Validate SMTP connection
      await this.validateSMTPConnection(updateSettingDto);

      for (const settingObj of updateSettingDto) {
        const setting = await this.settingsRepo.findOne({
          where: { settingKey: settingObj.settingKey },
        });
        if (!setting) {
          throw new HttpException(
            {
              message: `Setting with key ${settingObj.settingKey} not found`,
              statusCode: HttpStatus.NOT_FOUND,
              error: `Setting with key ${settingObj.settingKey} not found`,
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
      this.logger.error('Error updating setting', error);
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
