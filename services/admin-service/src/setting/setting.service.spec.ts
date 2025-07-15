import { Test, TestingModule } from '@nestjs/testing';
import { SettingService } from './setting.service';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { HttpException, HttpStatus } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SettingType } from './dto/create-setting.dto';
import { CreateSettingDto } from './dto/create-setting.dto';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory } from '../project/project.service.spec';

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
        { provide: LoggerFactory, useValue: {
            create: jest.fn().mockReturnValue({
              log: jest.fn(),
              error: jest.fn(),
            }),
          } as typeof mockLoggerFactory },
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

      jest.spyOn(settingsRepo, 'find').mockResolvedValue([]);
      jest.spyOn(service, 'testSMTPConnection').mockResolvedValue(true);
      jest.spyOn(settingsRepo, 'create').mockReturnValue(createdEntity);
      jest.spyOn(settingsRepo, 'save').mockResolvedValue(createdEntity);

      const result = await service.create(createSettingDto);

      expect(settingsRepo.find).toHaveBeenCalledTimes(createSettingDto.length);
      expect(settingsRepo.create).toHaveBeenCalledTimes(createSettingDto.length);
      expect(settingsRepo.save).toHaveBeenCalledTimes(createSettingDto.length);
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
        message: 'Settings retrieved successfully',
        statusCode: HttpStatus.OK,
        data: {
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
        },
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
