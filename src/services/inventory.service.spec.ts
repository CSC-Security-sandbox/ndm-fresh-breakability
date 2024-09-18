import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InventoryService } from './inventory.service';
import { Inventory } from '../schemas/inventory.schema';

const mockInventory = {
  _id: '123',
  fileName: 'test',
  folder: true,
  metadata: {
    rwxflag: 'rwx',
    gid: 1001,
    uid: 1001,
    timestamp: new Date(),
  },
};

const mockInventoryModel = {
  create: jest.fn().mockResolvedValue(mockInventory),

  findById: jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue(mockInventory),
  }),
  findByIdAndUpdate: jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue(mockInventory),
  }),
  findByIdAndDelete: jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue(mockInventory),
  }),
  find: jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue([mockInventory]),
  }),
};


describe('InventoryService', () => {
  let service: InventoryService;
  let model: Model<Inventory>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: getModelToken('Inventory'),
          useValue: mockInventoryModel,
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    model = module.get<Model<Inventory>>(getModelToken('Inventory'));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // describe('createInventory', () => {
  //   it('should create a new inventory', async () => {
  //     const result = await service.createInventory(mockInventory);
  //     expect(mockInventoryModel.create).toHaveBeenCalledWith(mockInventory);
  //     expect(result).toEqual(mockInventory);
  //   });
  // });

  describe('getInventoryById', () => {
    it('should return a single inventory by id', async () => {
      const result = await service.getInventoryById('123');
      expect(model.findById).toHaveBeenCalledWith('123');
      expect(result).toEqual(mockInventory);
    });
  });

  // describe('updateInventory', () => {
  //   it('should update an existing inventory', async () => {
  //     const result = await service.updateInventory('123', { name: 'updatedTest' });
  //     expect(model.findByIdAndUpdate).toHaveBeenCalledWith('123', { name: 'updatedTest' }, { new: true });
  //     expect(result).toEqual(mockInventory);
  //   });
  // });

  describe('deleteInventory', () => {
    it('should delete an inventory by id', async () => {
      const result = await service.deleteInventory('123');
      expect(model.findByIdAndDelete).toHaveBeenCalledWith('123');
      expect(result).toEqual(mockInventory);
    });
  });

  describe('getAllInventories', () => {
    it('should return all inventories', async () => {
      const result = await service.getAllInventories();
      expect(model.find).toHaveBeenCalled();
      expect(result).toEqual([mockInventory]);
    });
  });
});
