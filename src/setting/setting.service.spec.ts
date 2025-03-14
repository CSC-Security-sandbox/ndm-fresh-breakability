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
    settingsRepo = module.get<Repository<GlobalSettings>>(getRepositoryToken(GlobalSettings));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create settings successfully', async () => {
      const dto: CreateSettingDto[] = [
        { settingKey: 'SMTP_HOST', settingValue: 'smtp.example.com', settingType: SettingType.SMTP, description: 'SMTP Host' },
      ];

      jest.spyOn(service, 'testSMTPConnection').mockResolvedValue(true);
      mockSettingsRepo.find.mockResolvedValue([]);
      mockSettingsRepo.create.mockImplementation((data) => data);
      mockSettingsRepo.save.mockResolvedValue(dto[0]);

      const result = await service.create(dto);
      expect(result).toEqual({
        message: 'Settings created successfully',
        statusCode: HttpStatus.CREATED,
      });
    });

    it('should throw error if SMTP connection fails', async () => {
      const dto = [
        { settingKey: 'SMTP_HOST', settingValue: 'smtp.example.com', settingType: SettingType.SMTP, description: 'SMTP Host' },
        { settingKey: 'SMTP_PORT', settingValue: '587', settingType: SettingType.SMTP, description: 'SMTP Port' },
        {settingKey: 'SMTP_USER_NAME', settingValue: 'user', settingType: SettingType.SMTP, description: 'SMTP User Name'},
        {settingKey: 'SMTP_PASSWORD', settingValue: 'password', settingType: SettingType.SMTP, description: 'SMTP Password'},
      ];
      jest.spyOn(service, 'testSMTPConnection').mockResolvedValue(false);

      await expect(service.create(dto)).rejects.toThrow(HttpException);
    });

    it('should throw error if setting key already exists', async () => {
      const dto = [{ settingKey: 'SMTP_HOST', settingValue: 'smtp.example.com', settingType: SettingType.SMTP, description: 'SMTP Host' },];
      mockSettingsRepo.find.mockResolvedValue([dto]);

      await expect(service.create(dto)).rejects.toThrow(HttpException);
    });
  });
  describe('findAll', () => {
    it('should return all settings grouped by settingType', async () => {
      const mockData = [
        { id: 1, settingKey: 'SMTP_HOST', settingValue: 'smtp.example.com', settingType: 'SMTP' },
        { id: 2, settingKey: 'SMTP_PORT', settingValue: '587', settingType: 'SMTP' },
      ];
      mockSettingsRepo.find.mockResolvedValue(mockData);

      const result = await service.findAll();
      expect(result.statusCode).toBe(HttpStatus.OK);
      expect(result.data).toHaveProperty('SMTP');
    });

    it('should throw an error if retrieval fails', async () => {
      mockSettingsRepo.find.mockRejectedValue(new Error('Database error'));

      await expect(service.findAll()).rejects.toThrow(HttpException);
    });
  });

  describe('findOne', () => {
    it('should return settings of a given type', async () => {
      const settingType = 'SMTP';
      const mockData = [{ id: 1, settingKey: 'SMTP_HOST', settingValue: 'smtp.example.com', settingType: 'SMTP' }];
      mockSettingsRepo.find.mockResolvedValue(mockData);

      const result = await service.findOne(settingType);
      expect(result).toEqual(mockData);
    });

    it('should return an empty array if no settings found', async () => {
      mockSettingsRepo.find.mockResolvedValue([]);

      const result = await service.findOne('UNKNOWN_TYPE');
      expect(result).toEqual([]);
    });
  });

  describe('updateSetting', () => {
    it('should update a setting successfully', async () => {
      const dto = [{ settingKey: 'SMTP_HOST', settingValue: 'smtp.new.com', settingType: SettingType.SMTP, description: 'New SMTP Host' }];
      const existingSetting = { id: 1, settingKey: 'SMTP_HOST', settingValue: 'smtp.old.com', settingType: 'SMTP' };
      mockSettingsRepo.findOne.mockResolvedValue(existingSetting);
      mockSettingsRepo.save.mockResolvedValue({ ...existingSetting, settingValue: dto[0].settingValue });

      const result = await service.updateSetting(dto);
      expect(result).toEqual({ message: 'Setting updated successfully', statusCode: HttpStatus.OK });
    });

    it('should throw error if setting does not exist', async () => {
      mockSettingsRepo.findOne.mockResolvedValue(null);
      const dto = [{ settingKey: 'UNKNOW_KEY', settingValue: 'smtp.new.com', settingType: SettingType.SMTP, description: 'New SMTP Host' }];

      await expect(service.updateSetting(dto)).rejects.toThrow(HttpException);
    });
  });
});

  
