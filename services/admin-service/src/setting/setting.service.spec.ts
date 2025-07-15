import { Test, TestingModule } from '@nestjs/testing';
import { SettingService } from './setting.service';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { HttpException, HttpStatus } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SettingType } from './dto/create-setting.dto';
import { CreateSettingDto } from './dto/create-setting.dto';

const mockSettingsRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
};
jest.mock('nodemailer-express-handlebars', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    use: jest.fn(),
  })),
}));
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

describe('SettingService', () => {
  let service: SettingService;
  let settingsRepo: Repository<GlobalSettings>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingService,
        {
          provide: getRepositoryToken(GlobalSettings),
          useValue: mockSettingsRepo,
        },
      ],
    }).compile();

    service = module.get<SettingService>(SettingService);
    settingsRepo = module.get<Repository<GlobalSettings>>(
      getRepositoryToken(GlobalSettings),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should throw an error if SMTP connection fails', async () => {
      const createSettingDto: CreateSettingDto[] = [
        {
          settingKey: 'SMTP_HOST',
          settingValue: 'localhost',
          description: 'SMTP Host',
          settingType: SettingType.SMTP,
        },
      ];
      jest.spyOn(settingsRepo, 'find').mockResolvedValue([]);
      jest.spyOn(service, 'testSMTPConnection').mockResolvedValue(false);

      await expect(service.create(createSettingDto)).rejects.toThrow(
        HttpException,
      );
    });

    it('should throw an error if setting already exists', async () => {
      const createSettingDto: CreateSettingDto[] = [
        {
          settingKey: 'SMTP_HOST',
          settingValue: 'smtp.gmail.com',
          description: 'SMTP Host for sending emails',
          settingType: SettingType.SMTP,
        },
      ];

      jest.spyOn(settingsRepo, 'find').mockResolvedValue([
        {
          settingKey: 'SMTP_HOST',
          settingValue: 'smtp.gmail.com',
          description: 'SMTP Host for sending emails',
          settingType: SettingType.SMTP,
          id: '1',
          created_at: new Date(),
          created_by: '',
          updated_at: new Date(),
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
      ]);

      await expect(service.create(createSettingDto)).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('testSMTPConnection', () => {
    it('should return true for a successful SMTP connection', async () => {
      const createSettingDto: CreateSettingDto[] = [
        {
          settingKey: 'SMTP_HOST',
          settingValue: 'localhost',
          description: 'SMTP Host',
          settingType: SettingType.SMTP,
        },
        {
          settingKey: 'SMTP_PORT',
          settingValue: '587',
          description: 'SMTP Port',
          settingType: SettingType.SMTP,
        },
        {
          settingKey: 'SMTP_USER_NAME',
          settingValue: 'user',
          description: 'SMTP User',
          settingType: SettingType.SMTP,
        },
        {
          settingKey: 'SMTP_PASSWORD',
          settingValue: 'pass',
          description: 'SMTP Password',
          settingType: SettingType.SMTP,
        },
      ];

      const transporterMock = {
        verify: jest.fn().mockResolvedValue(true),
        sendMail: jest.fn(),
      };
      jest
        .spyOn(nodemailer, 'createTransport')
        .mockReturnValue(transporterMock as any);

      const result = await service.testSMTPConnection(createSettingDto);
      expect(result).toBe(true);
    });

    it('should throw an error when SMTP password decryption fails', async () => {
      const createSettingDto: CreateSettingDto[] = [
        {
          settingKey: 'SMTP_PASSWORD',
          settingValue: 'encrypted:password',
          description: 'SMTP Password',
          settingType: SettingType.SMTP,
        }
      ];

      jest.mock('../utils/crypto-utils', () => ({
        decryptData: jest.fn().mockImplementation(() => {
          throw new Error('');
        })
      }));

      await expect(service.create(createSettingDto)).rejects.toThrow(
          new HttpException(
              {
                message: 'Error while retrieving settings: An internal error occurred',
                statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
              },
              HttpStatus.INTERNAL_SERVER_ERROR,
          )
      );
    });

    it('should return false for a failed SMTP connection', async () => {
      const createSettingDto: CreateSettingDto[] = [
        {
          settingKey: 'SMTP_HOST',
          settingValue: 'localhost',
          description: 'SMTP Host',
          settingType: SettingType.SMTP,
        },
        {
          settingKey: 'SMTP_PORT',
          settingValue: '587',
          description: 'SMTP Port',
          settingType: SettingType.SMTP,
        },
      ];

      const transporterMock = {
        verify: jest.fn().mockRejectedValue(new Error('Connection failed')),
        sendMail: jest.fn(),
      };
      jest
        .spyOn(nodemailer, 'createTransport')
        .mockReturnValue(transporterMock as any);

      const result = await service.testSMTPConnection(createSettingDto);
      expect(result).toBe(false);
    });
  });

  describe('findAll', () => {
    it('should throw an error if retrieval fails', async () => {
      jest
        .spyOn(settingsRepo, 'find')
        .mockRejectedValue(new Error('Database error'));

      await expect(service.findAll()).rejects.toThrow(HttpException);
    });
  });

  describe('findOne', () => {
    it('should return settings of a specific type', async () => {
      const settings: GlobalSettings[] = [
        {
          id: '1',
          settingKey: 'SMTP_HOST',
          settingValue: 'smtp.gmail.com',
          description: 'SMTP Host for sending emails',
          settingType: 'SMTP',
          created_at: new Date(),
          updated_at: new Date(),
          created_by: '',
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
      ];
      jest.spyOn(settingsRepo, 'find').mockResolvedValue(settings);

      const result = await service.findOne('SMTP');
      expect(result).toEqual(settings);
    });
  });

  describe('updateSetting', () => {
    it('should update an existing setting', async () => {
      const updateSettingDto: CreateSettingDto[] = [
        {
          settingKey: 'SMTP_HOST',
          settingValue: 'newhost',
          description: 'Updated host',
          settingType: SettingType.SMTP,
        },
      ];
      const existingSetting: GlobalSettings = {
        id: '1',
        settingKey: 'SMTP_HOST',
        settingValue: 'localhost',
        description: '',
        settingType: SettingType.SMTP,
        created_at: new Date(),
        created_by: '',
        updated_at: new Date(),
        updated_by: '',
        populateWhoColumns: jest.fn(),
      };
      jest.spyOn(settingsRepo, 'findOne').mockResolvedValue(existingSetting);
      jest.spyOn(settingsRepo, 'save').mockResolvedValue({
        ...existingSetting,
        ...updateSettingDto[0],
        populateWhoColumns: jest.fn(),
      });

      const result = await service.updateSetting(updateSettingDto);
      expect(result).toEqual({
        message: 'Setting updated successfully',
        statusCode: HttpStatus.OK,
      });
    });

    it('should throw an error when SMTP password decryption fails while updating', async () => {
      const updateSettingDto: CreateSettingDto[] = [
        {
          settingKey: 'SMTP_PASSWORD',
          settingValue: 'encrypted:password',
          description: 'SMTP Password',
          settingType: SettingType.SMTP,
        }
      ];

      jest.mock('../utils/crypto-utils', () => ({
        decryptData: jest.fn().mockImplementation(() => {
          throw new Error('');
        })
      }));

      await expect(service.updateSetting(updateSettingDto)).rejects.toThrow(
          new HttpException(
              {
                message: 'Error while updating settings: An internal error occurred',
                statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
              },
              HttpStatus.INTERNAL_SERVER_ERROR,
          )
      );
    });

    it('should throw an error if setting not found', async () => {
      const updateSettingDto: CreateSettingDto[] = [
        {
          settingKey: 'SMTP_HOST',
          settingValue: 'newhost',
          description: 'Updated host',
          settingType: SettingType.SMTP,
        },
      ];
      jest.spyOn(settingsRepo, 'findOne').mockResolvedValue(null);

      await expect(service.updateSetting(updateSettingDto)).rejects.toThrow(
        HttpException,
      );
    });
  });
});
