import { Test, TestingModule } from '@nestjs/testing';
import { InventoryController } from './inventory.controller';
import { InventoryService } from '../services/inventory.service';
import { Inventory } from '../schemas/inventory.schema';

describe('InventoryController', () => {
  let controller: InventoryController;
  let inventoryService: InventoryService;

  const mockInventoryService = {
    createInventory: jest.fn((data: Partial<Inventory>) => {
      return {
        _id: '111',
        ...data,
      };
    }),
    getInventoryById: jest.fn((id: string) => {
      return {
        _id: id,
        name: 'test',
        folder: false,
        metadata: {
          rwxflag: 'rwx',
          gid: 1001,
          uid: 1001,
          timestamp: new Date(),
        },
      };
    }),
    updateInventory: jest.fn((id: string, data: Partial<Inventory>) => {
      return {
        _id: id,
        name: 'updatedTest',
        folder: false,
      };
    }),
    deleteInventory: jest.fn((id: string) => {
      return {
        _id: id,
        name: 'deletedTest',
        folder: false,
      };
    }),
    getAllInventories: jest.fn(() => {
      return [
        { _id: '1', name: 'test', folder: true },
      ];
    }),
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
    inventoryService = module.get<InventoryService>(InventoryService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createInventory', () => {
    it('should create a new inventory', async () => {
      const inventoryData: Partial<Inventory> = {
        name: 'test',
        folder: false,
        metadata: {
          rwxflag: 'rwx',
          gid: 1001,
          uid: 1001,
          timestamp: new Date(),
        },
      };
      const result = await controller.createInventory(inventoryData);

      expect(inventoryService.createInventory).toHaveBeenCalledWith(inventoryData);
      expect(result).toEqual({ _id: '111', ...inventoryData });
    });
  });

  describe('getInventoryById', () => {
    it('should return inventory by id', async () => {
      const id = '222';
      const result = await controller.getInventoryById(id);

      expect(inventoryService.getInventoryById).toHaveBeenCalledWith(id);
      expect(result).toEqual({
        _id: id,
        name: 'test',
        folder: false,
        metadata: expect.any(Object),
      });
    });
  });

  describe('updateInventory', () => {
    it('should call inventoryService.updateInventory and return updated inventory', async () => {
      const mockId = '123';
      const mockUpdateData: Partial<Inventory> = { name: 'updatedTest', folder: false };
      const result = await controller.updateInventory(mockId, mockUpdateData);

      expect(inventoryService.updateInventory).toHaveBeenCalledWith(mockId, mockUpdateData);
      expect(result).toEqual({ _id: mockId, ...mockUpdateData });
    });
  });

  describe('deleteInventory', () => {
    it('should call inventoryService.deleteInventory and return deleted inventory', async () => {
      const mockId = '113';
      const result = await controller.deleteInventory(mockId);

      expect(inventoryService.deleteInventory).toHaveBeenCalledWith(mockId);
      expect(result).toEqual({ _id: mockId, name: 'deletedTest', folder: false });
    });
  });

  describe('getAllInventories', () => {
    it('should call inventoryService.getAllInventories and return all inventories', async () => {
      const result = await controller.getAllInventories();

      expect(inventoryService.getAllInventories).toHaveBeenCalled();
      expect(result).toEqual([
        { _id: '1', name: 'test', folder: true },
      ]);
    });
  });
});


