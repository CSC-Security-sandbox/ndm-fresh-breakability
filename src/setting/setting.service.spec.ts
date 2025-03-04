import { Test, TestingModule } from '@nestjs/testing';
import { SettingService } from './setting.service';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { Repository } from 'typeorm';
import { CreateSettingDto, SettingType } from './dto/create-setting.dto';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpStatus } from '@nestjs/common';

describe('SettingService', () => {
  let service: SettingService;
  let settingsRepo: Repository<GlobalSettings>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
      SettingService,
      {
        provide: getRepositoryToken(GlobalSettings),
        useClass: Repository,
      },
      ],
    }).compile();

    service = module.get<SettingService>(SettingService);
    settingsRepo = module.get<Repository<GlobalSettings>>(getRepositoryToken(GlobalSettings));
  });

   
  it('should be defined', () => {
    expect(service).toBeDefined();
  });


  describe('findAll', () => {
    it('should return all settings', async () => {
      const allSettings: GlobalSettings[] = [
        { id: '1', settingKey: 'Setting 1', settingValue: 'Value 1' ,description: 'Description 1', settingType: SettingType.SMTP,created_at: new Date(),updated_at: new Date(),created_by: 'admin',updated_by: 'admin',populateWhoColumns: jest.fn()},
        { id: '1', settingKey: 'Setting 1', settingValue: 'Value 1' ,description: 'Description 1', settingType: SettingType.SMTP,created_at: new Date(),updated_at: new Date(),created_by: 'admin',updated_by: 'admin',populateWhoColumns: jest.fn()},
      ];

      jest.spyOn(settingsRepo, 'find').mockResolvedValue(allSettings);
      const expected ={"data": {"SMTP": [{"description": "Description 1", "id": "1", "settingKey": "Setting 1", "settingType": "SMTP", "settingValue": "Value 1"}, {"description": "Description 1", "id": "1", "settingKey": "Setting 1", "settingType": "SMTP", "settingValue": "Value 1"}]}, "message": "Settings retrieved successfully", "statusCode": 200}

      const result = await service.findAll();

      expect(result).toEqual(expected);
      expect(settingsRepo.find).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a setting by settingType', async () => {
      const settingType = 'Setting 1';
      const setting: GlobalSettings[] = [{ id: "1", settingKey: 'Setting 1', settingValue: 'Value 1', description: 'Description 1', settingType: SettingType.SMTP,created_at: new Date(),updated_at: new Date(),created_by: 'admin',updated_by: 'admin',populateWhoColumns: jest.fn()}];

      jest.spyOn(settingsRepo, 'find').mockResolvedValue(setting);

      const result = await service.findOne(settingType);

      expect(result).toEqual(setting);
    });
  });
  describe('create', () => {
    it('should create settings', async () => {
      const createSettingDto: CreateSettingDto[] = [
        { settingKey: 'Setting 1', settingValue: 'Value 1', description: 'Description 1', settingType: SettingType.SMTP },
      ];
      const savedSettings: GlobalSettings[] = [
        { id: '1', settingKey: 'Setting 1', settingValue: 'Value 1' ,description: 'Description 1', settingType: SettingType.SMTP,created_at: new Date(),updated_at: new Date(),created_by: 'admin',updated_by: 'admin',populateWhoColumns: jest.fn()},
      ] as GlobalSettings[];
  
      jest.spyOn(settingsRepo, 'save').mockResolvedValue(savedSettings as any);
      jest.spyOn(settingsRepo, 'create').mockReturnValue(savedSettings[0]);
  
  
      const result = await service.create(createSettingDto);
  
      expect(result).toEqual({
        message: 'Settings created successfully',
        statusCode: HttpStatus.CREATED,
      });
    });
  });
});