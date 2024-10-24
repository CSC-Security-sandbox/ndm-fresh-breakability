import { Test, TestingModule } from '@nestjs/testing';
import { DiscoveryService } from './discovery.service';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InventoryEntity } from '../entities/inventory.entity';

describe('DiscoveryService', () => {
  let discoveryService: DiscoveryService;
  let inventoryRepo: Repository<InventoryEntity>;

  const mockInventoryRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscoveryService,
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: mockInventoryRepo,
        },
      ],
    }).compile();

    discoveryService = module.get<DiscoveryService>(DiscoveryService);
    inventoryRepo = module.get<Repository<InventoryEntity>>(getRepositoryToken(InventoryEntity));
  });

  it('should be defined', () => {
    expect(discoveryService).toBeDefined();
  });

  describe('getDiscoveryByFileServerId', () => {
    it('should return transformed data based on the file server ID', async () => {
      const mockData = { mount_path: '/test/mount', file_server: 'server1' };
      mockInventoryRepo.findOne.mockResolvedValue(mockData);
      mockInventoryRepo.find.mockResolvedValue([{ fileName: 'file1' }]);

      const result = await discoveryService.getDiscoveryByFileServerId('server1');
      expect(result).toEqual([{ root: 'mount', childs: [{ fileName: 'file1', childs: [] }] }]);
      expect(mockInventoryRepo.findOne).toHaveBeenCalledWith({ where: { file_server: 'server1' } });
      expect(mockInventoryRepo.find).toHaveBeenCalledWith({ where: { file_server: 'server1', parent_path: '/test/mount' } });
    });
  });

  describe('getDiscoveryByFileServerIdAndParentPath', () => {
    it('should return data for the given fileServerId and parentPath', async () => {
      const mockData = [{ fileName: 'file1' }];
      mockInventoryRepo.find.mockResolvedValue(mockData);

      const result = await discoveryService.getDiscoveryByFileServerIdAndParentPath('server1', '/test/path');
      expect(result).toEqual([{ fileName: 'file1', childs: [] }]);
      expect(mockInventoryRepo.find).toHaveBeenCalledWith({ where: { file_server: 'server1', parent_path: '/test/path' } });
    });
  });

  describe('getDataFromParentPath', () => {
    it('should call find on the inventoryRepo with correct parameters', async () => {
      const mockData = [{ fileName: 'file1' }];
      mockInventoryRepo.find.mockResolvedValue(mockData);

      const result = await discoveryService.getDataFromParentPath('server1', '/test/path');
      expect(result).toEqual(mockData);
      expect(mockInventoryRepo.find).toHaveBeenCalledWith({ where: { file_server: 'server1', parent_path: '/test/path' } });
    });
  });
});
