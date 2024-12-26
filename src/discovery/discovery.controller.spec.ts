import { Test, TestingModule } from '@nestjs/testing';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { BadRequestException } from '@nestjs/common';
import { ReportsEntity } from 'src/entities/reports.entity';

describe('DiscoveryController', () => {
  let discoveryController: DiscoveryController;
  let discoveryService: DiscoveryService;

  const mockDiscoveryService = {
    getDiscoveryByFileServerId: jest.fn(),
    getDiscoveryByFileServerIdAndParentPath: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DiscoveryController, ReportsEntity],
      providers: [
        {
          provide: DiscoveryService,
          useValue: mockDiscoveryService,
        },
      ],
    }).compile();

    discoveryController = module.get<DiscoveryController>(DiscoveryController);
    discoveryService = module.get<DiscoveryService>(DiscoveryService);
  });

  it('should be defined', () => {
    expect(discoveryController).toBeDefined();
  });

  describe('discoverFileServerDefault', () => {
    it('should throw BadRequestException when fileServerId is not provided', async () => {
      await expect(
        discoveryController.discoverFileServerDefault(null),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return data from discoveryService', async () => {
      const mockResponse = [{ root: 'testRoot', childs: [] }];
      mockDiscoveryService.getDiscoveryByFileServerId.mockResolvedValue(mockResponse);

      const result = await discoveryController.discoverFileServerDefault('testFileServerId');
      expect(result).toEqual(mockResponse);
      expect(mockDiscoveryService.getDiscoveryByFileServerId).toHaveBeenCalledWith('testFileServerId');
    });
  });

  describe('discoverFileServerWithPath', () => {
    it('should throw BadRequestException when fileServerId is not provided', async () => {
      await expect(
        discoveryController.discoverFileServerWithPath(null, 'testParentPath'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should return data from discoveryService with path', async () => {
      const mockResponse = [{ fileName: 'file1', childs: [] }];
      mockDiscoveryService.getDiscoveryByFileServerIdAndParentPath.mockResolvedValue(mockResponse);

      const result = await discoveryController.discoverFileServerWithPath('testFileServerId', 'testParentPath');
      expect(result).toEqual(mockResponse);
      expect(mockDiscoveryService.getDiscoveryByFileServerIdAndParentPath).toHaveBeenCalledWith('testFileServerId', 'testParentPath');
    });
  });
});
