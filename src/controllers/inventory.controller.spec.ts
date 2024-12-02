import { Test, TestingModule } from '@nestjs/testing';
import { InventoryController } from './inventory.controller';
import { InventoryService } from '../services/inventory.service';
import { createInventoryDTO } from 'src/dto/create-inventory.dto';

describe('InventoryController', () => {
  let controller: InventoryController;
  let service: InventoryService;

  const mockInventoryService = {
    createInventory: jest.fn(),
    getInventoryById: jest.fn(),
    updateInventory: jest.fn(),
    deleteInventory: jest.fn(),
    getAllInventories: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [
        {
          provide: InventoryService,
          useValue: mockInventoryService,
        },
      ],
    }).compile();

    controller = module.get<InventoryController>(InventoryController);
    service = module.get<InventoryService>(InventoryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createInventory', () => {
    it('should create a new inventory item', async () => {
      const dto: createInventoryDTO = {
        mountPath: '/mnt/storage',
        fileServer: 'server1',
        fileName: 'file.txt',
        type: 'file',
        metadata: {
          uid: 1000,
          gid: 1000,
          blksize: 4096,
          size: 1024,
          blocks: 8,
          mtime: '2024-01-01T00:00:00Z',
          birthtime: '2024-01-01T00:00:00Z',
          fileName: 'file.txt',
          filePath: '/mnt/storage/file.txt',
          extension: '.txt',
          type: 'file',
          folder: false,
          permission: 'rw-r--r--',
        },
      };

      const expectedResult = { id: '1', ...dto };

      mockInventoryService.createInventory.mockResolvedValue(expectedResult);

      const result = await controller.createInventory(dto);
      
      expect(result).toEqual(expectedResult);
      expect(mockInventoryService.createInventory).toHaveBeenCalledWith(dto);
    });
  });

  describe('getInventoryById', () => {
    it('should return an inventory item by ID', async () => {
      const inventoryId = '1';
      const expectedInventory = { id: inventoryId, fileName: 'file.txt' };

      mockInventoryService.getInventoryById.mockResolvedValue(expectedInventory);

      const result = await controller.getInventoryById(inventoryId);

      expect(result).toEqual(expectedInventory);
      expect(mockInventoryService.getInventoryById).toHaveBeenCalledWith(inventoryId);
    });
  });

  describe('updateInventory', () => {
    it('should update an inventory item', async () => {
      const inventoryId = '1';
      const updateData = { fileName: 'updated-file.txt' };
      const expectedResult = { id: inventoryId, ...updateData };

      mockInventoryService.updateInventory.mockResolvedValue(expectedResult);

      const result = await controller.updateInventory(inventoryId, updateData);

      expect(result).toEqual(expectedResult);
      expect(mockInventoryService.updateInventory).toHaveBeenCalledWith(inventoryId, updateData);
    });
  });

  describe('deleteInventory', () => {
    it('should delete an inventory item', async () => {
      const inventoryId = '1';
      const expectedResult = { deleted: true };

      mockInventoryService.deleteInventory.mockResolvedValue(expectedResult);

      const result = await controller.deleteInventory(inventoryId);

      expect(result).toEqual(expectedResult);
      expect(mockInventoryService.deleteInventory).toHaveBeenCalledWith(inventoryId);
    });
  });

  describe('getAllInventories', () => {
    it('should return all inventory items', async () => {
      const expectedInventories = [{ id: '1', fileName: 'file.txt' }, { id: '2', fileName: 'file2.txt' }];

      mockInventoryService.getAllInventories.mockResolvedValue(expectedInventories);

      const result = await controller.getAllInventories();

      expect(result).toEqual(expectedInventories);
      expect(mockInventoryService.getAllInventories).toHaveBeenCalled();
    });
  });
});
