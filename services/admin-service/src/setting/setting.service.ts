import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { CreateSettingDto } from './dto/create-setting.dto';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
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

      const entities = createSettingDto.map((setting) =>
        this.settingsRepo.create(setting),
      );

      await this.settingsRepo.upsert(entities, {
        conflictPaths: ['settingKey'],
        skipUpdateIfNoValuesChanged: true,
      });

      return {
        message: 'SMTP details added successfully.',
        statusCode: HttpStatus.CREATED,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
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
      const settings = await this.settingsRepo.find({ take: 1000 });
      const groupedSettings = settings.reduce((acc, setting) => {
        const type = setting.settingType;
        if (!acc[type]) {
          acc[type] = [];
        }

        acc[type].push({
          id: setting.id,
          settingKey: setting.settingKey,
          settingValue:
            setting.settingKey === 'SMTP_PASSWORD' ? '' : setting.settingValue,
          description: setting.description,
          settingType: setting.settingType,
        });
        return acc;
      }, {});

      return groupedSettings;
    } catch (error) {
      this.logger.error('Error retrieving settings', error);
      throw new HttpException(
        'Error retrieving settings',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findOne(settingType: string) {
    try {
      return await this.settingsRepo.find({
        where: { settingType: settingType },
        take: 1000,
      });
    } catch (error) {
      this.logger.error('Error finding settings by type', error);
      throw new HttpException(
        'Error finding settings',
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

      const keys = updateSettingDto.map((s) => s.settingKey);
      const existingSettings = await this.settingsRepo.find({
        where: { settingKey: In(keys) },
      });

      const existingMap = new Map(existingSettings.map((s) => [s.settingKey, s]));
      for (const settingObj of updateSettingDto) {
        if (!existingMap.has(settingObj.settingKey)) {
          throw new HttpException(
            {
              message: `Setting with key ${settingObj.settingKey} not found`,
              statusCode: HttpStatus.NOT_FOUND,
              error: `Setting with key ${settingObj.settingKey} not found`,
            },
            HttpStatus.NOT_FOUND,
          );
        }
      }

      const toSave = updateSettingDto.map((settingObj) => {
        const existing = existingMap.get(settingObj.settingKey);
        existing.settingValue = settingObj.settingValue;
        existing.description = settingObj.description;
        return existing;
      });

      await this.settingsRepo.save(toSave);

      return {
        message: 'Setting updated successfully',
        statusCode: HttpStatus.OK,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
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
