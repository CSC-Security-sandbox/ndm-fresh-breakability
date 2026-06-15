import { Test, TestingModule } from '@nestjs/testing';
import { SettingService } from './setting.service';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { HttpException, HttpStatus } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { CreateSettingDto, SettingType } from './dto/create-setting.dto';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import {
  mockLoggerFactory,
  resetLoggerMocks,
} from '../test-utils/logger-mocks';

const mockSettingsRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  upsert: jest.fn(),
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
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
      ],
    }).compile();

    service = module.get<SettingService>(SettingService);
    settingsRepo = module.get<Repository<GlobalSettings>>(
      getRepositoryToken(GlobalSettings),
    );
  });

  afterEach(() => {
    resetLoggerMocks();
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

    it('should successfully create settings when SMTP connection is successful', async () => {
      const createSettingDto: CreateSettingDto[] = [
        {
          settingKey: 'SMTP_HOST',
          settingValue: 'smtp.gmail.com',
          description: 'SMTP Host for sending emails',
          settingType: SettingType.SMTP,
        },
        {
          settingKey: 'SMTP_PORT',
          settingValue: '587',
          description: 'SMTP Port',
          settingType: SettingType.SMTP,
        },
      ];

      const createdEntity = {
        id: '1',
        ...createSettingDto[0],
        created_at: new Date(),
        created_by: '',
        updated_at: new Date(),
        updated_by: '',
        populateWhoColumns: jest.fn(),
      };

      jest.spyOn(service, 'testSMTPConnection').mockResolvedValue(true);
      jest.spyOn(settingsRepo, 'create').mockReturnValue(createdEntity);
      jest.spyOn(settingsRepo, 'upsert').mockResolvedValue(undefined);

      const result = await service.create(createSettingDto);

      expect(settingsRepo.create).toHaveBeenCalledTimes(createSettingDto.length);
      expect(settingsRepo.upsert).toHaveBeenCalled();
      expect(result).toEqual({
        message: 'SMTP details added successfully.',
        statusCode: HttpStatus.CREATED,
      });
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
        },
      ];

      jest.mock('../utils/crypto-utils', () => ({
        decryptData: jest.fn().mockImplementation(() => {
          throw new Error('');
        }),
      }));

      await expect(service.create(createSettingDto)).rejects.toThrow(
        new HttpException(
          {
            message:
              'Error while retrieving settings: An internal error occurred',
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
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

    it('should successfully retrieve and group settings by type', async () => {
      const mockSettings: GlobalSettings[] = [
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
        {
          id: '2',
          settingKey: 'SMTP_PORT',
          settingValue: '587',
          description: 'SMTP Port',
          settingType: 'SMTP',
          created_at: new Date(),
          updated_at: new Date(),
          created_by: '',
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
        {
          id: '3',
          settingKey: 'API_KEY',
          settingValue: 'abc123',
          description: 'API Key',
          settingType: 'API',
          created_at: new Date(),
          updated_at: new Date(),
          created_by: '',
          updated_by: '',
          populateWhoColumns: jest.fn(),
        },
      ];

      jest.spyOn(settingsRepo, 'find').mockResolvedValue(mockSettings);

      const result = await service.findAll();

      expect(settingsRepo.find).toHaveBeenCalled();
      expect(result).toEqual({
        SMTP: [
          {
            id: '1',
            settingKey: 'SMTP_HOST',
            settingValue: 'smtp.gmail.com',
            description: 'SMTP Host for sending emails',
            settingType: 'SMTP',
          },
          {
            id: '2',
            settingKey: 'SMTP_PORT',
            settingValue: '587',
            description: 'SMTP Port',
            settingType: 'SMTP',
          },
        ],
        API: [
          {
            id: '3',
            settingKey: 'API_KEY',
            settingValue: 'abc123',
            description: 'API Key',
            settingType: 'API',
          },
        ],
      });
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

      jest.spyOn(service, 'testSMTPConnection').mockResolvedValue(true);
      jest.spyOn(settingsRepo, 'find').mockResolvedValue([existingSetting]);
      jest.spyOn(settingsRepo, 'save').mockResolvedValue([{
        ...existingSetting,
        ...updateSettingDto[0],
        populateWhoColumns: jest.fn(),
      }] as any);

      const result = await service.updateSetting(updateSettingDto);
      expect(result).toEqual({
        message: 'Setting updated successfully',
        statusCode: HttpStatus.OK,
      });
    });

    it('should throw an error if SMTP connection fails during update', async () => {
      const updateSettingDto: CreateSettingDto[] = [
        {
          settingKey: 'SMTP_HOST',
          settingValue: 'invalid-host',
          description: 'Invalid SMTP Host',
          settingType: SettingType.SMTP,
        },
      ];

      jest.spyOn(service, 'testSMTPConnection').mockResolvedValue(false);

      await expect(service.updateSetting(updateSettingDto)).rejects.toThrow(
        new HttpException(
          {
            message: 'SMTP connection test failed',
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            error: 'SMTP connection test failed',
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );
    });

    it('should throw an error when SMTP password decryption fails while updating', async () => {
      const updateSettingDto: CreateSettingDto[] = [
        {
          settingKey: 'SMTP_PASSWORD',
          settingValue: 'encrypted:password',
          description: 'SMTP Password',
          settingType: SettingType.SMTP,
        },
      ];

      jest.mock('../utils/crypto-utils', () => ({
        decryptData: jest.fn().mockImplementation(() => {
          throw new Error('');
        }),
      }));

      await expect(service.updateSetting(updateSettingDto)).rejects.toThrow(
        new HttpException(
          {
            message:
              'Error while updating settings: An internal error occurred',
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
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
      jest.spyOn(service, 'testSMTPConnection').mockResolvedValue(true);
      jest.spyOn(settingsRepo, 'find').mockResolvedValue([]);

      await expect(service.updateSetting(updateSettingDto)).rejects.toThrow(
        HttpException,
      );
    });

    it('should batch-save all settings in one call', async () => {
      const updateSettingDto: CreateSettingDto[] = [
        {
          settingKey: 'SMTP_HOST',
          settingValue: 'newhost.example.com',
          description: 'Updated Host',
          settingType: SettingType.SMTP,
        },
        {
          settingKey: 'SMTP_PORT',
          settingValue: '465',
          description: 'Updated Port',
          settingType: SettingType.SMTP,
        },
      ];

      const existingSettings = [
        { settingKey: 'SMTP_HOST', settingValue: 'old.example.com', description: 'Host', settingType: 'SMTP' },
        { settingKey: 'SMTP_PORT', settingValue: '587', description: 'Port', settingType: 'SMTP' },
      ];

      jest.spyOn(service, 'testSMTPConnection').mockResolvedValue(true);
      jest.spyOn(settingsRepo, 'find').mockResolvedValue(existingSettings as any);
      jest.spyOn(settingsRepo, 'save').mockResolvedValue(existingSettings as any);

      await service.updateSetting(updateSettingDto);

      expect(settingsRepo.find).toHaveBeenCalledTimes(1);
      expect(settingsRepo.save).toHaveBeenCalledTimes(1);
      expect(settingsRepo.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ settingKey: 'SMTP_HOST', settingValue: 'newhost.example.com' }),
          expect.objectContaining({ settingKey: 'SMTP_PORT', settingValue: '465' }),
        ]),
      );
    });
  });
});
