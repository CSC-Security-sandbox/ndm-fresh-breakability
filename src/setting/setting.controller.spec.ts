
import { Test, TestingModule } from '@nestjs/testing';
import { SettingController } from './setting.controller';
import { SettingService } from './setting.service';
import { CreateSettingDto, SettingType } from './dto/create-setting.dto';
import { HttpStatus } from '@nestjs/common';
import { Repository } from 'typeorm';
import { GlobalSettings } from 'src/entities/global-setting.entity';
import { getRepositoryToken } from '@nestjs/typeorm';

describe('SettingController', () => {
  let controller: SettingController;
  let service: SettingService;
  let settingsRepo: Repository<GlobalSettings>;
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingController],
      providers: [SettingService
        ,{
          provide: getRepositoryToken(GlobalSettings),
          useClass: Repository,
        },
      ],
      
    }).compile();

    controller = module.get<SettingController>(SettingController);
    service = module.get<SettingService>(SettingService);
    settingsRepo = module.get<Repository<GlobalSettings>>(getRepositoryToken(GlobalSettings));
  });

  describe('create', () => {
    it('should create global settings', async () => {
      const createSettingDto: CreateSettingDto[] = [
       { settingKey: 'Setting 1', settingValue: 'Value 1', description: 'Description 1', settingType: SettingType.SMTP},
      ];

      jest.spyOn(service, 'create').mockResolvedValueOnce({ message: '', statusCode: HttpStatus.OK });

      const result = await controller.create(createSettingDto);

      expect(service.create).toHaveBeenCalledWith(createSettingDto);
      expect(result).toEqual({ message: '', statusCode: HttpStatus.OK });
    });
  });

  

  describe('findOne', () => {
    it('should get a global setting by setting type', async () => {
      const settingType = 'example';

      jest.spyOn(service, 'findOne').mockResolvedValueOnce(Promise.resolve([]));

      const result = await controller.findOne(settingType);

      expect(service.findOne).toHaveBeenCalledWith(settingType);
      expect(result).toEqual([]);
    });
  });
});