import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from './inventory.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryEntity } from '../entities/inventory.entity';
import { NotFoundException, Logger } from '@nestjs/common';
import { CreateInventoryDto } from '../dto/create-inventory.dto';
import { UpdateInventoryDto } from '../dto/update-inventory.dto';

describe('InventoryService', () => {
  let service: InventoryService;
  let inventoryRepo: Repository<InventoryEntity>;

  const mockInventory: InventoryEntity = {
    id: '1',
    pathId: 'path-1',
    jobRunId: 'run-1',
    path: '/test/path',
    isFolder: true,
    status: 'active',
    sourceChecksum: null,
    targetChecksum: null,
    parentPath: '/parent/path',
    depth: 2,
    fileName: 'file.txt',
    uid: 1001,
    gid: 1002,
    size: 1024,
    mtime: '2023-12-01T12:00:00.000Z',
    atime: '2023-12-01T12:00:00.000Z',
    birthtime: '2023-12-01T12:00:00.000Z',
    extension: '.txt',
    permission: 'rw-r--r--',
  };

  const mockInventoryRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: mockInventoryRepo,
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    inventoryRepo = module.get<Repository<InventoryEntity>>(getRepositoryToken(InventoryEntity));

    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => { });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => { });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => { });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findInventoryById', () => {
    it('should return inventory if it exists', async () => {
      mockInventoryRepo.findOne.mockResolvedValue(mockInventory);

      const result = await service['findInventoryById']('1');
      expect(result).toEqual(mockInventory);
      expect(mockInventoryRepo.findOne).toHaveBeenCalledWith({ where: { id: '1' } });
    });

    it('should throw NotFoundException if inventory does not exist', async () => {
      mockInventoryRepo.findOne.mockResolvedValue(null);

      await expect(service['findInventoryById']('1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createInventory', () => {
    it('should create and save an inventory', async () => {
      const dto: CreateInventoryDto = {
        ...mockInventory,
        blocks: 0
      };
      mockInventoryRepo.create.mockReturnValue(dto);
      mockInventoryRepo.save.mockResolvedValue(mockInventory);

      const result = await service.createInventory(dto);
      expect(result).toEqual(mockInventory);
      expect(mockInventoryRepo.create).toHaveBeenCalledWith(dto);
      expect(mockInventoryRepo.save).toHaveBeenCalledWith(dto);
    });

    it('should log an error and throw an exception if save fails', async () => {
      const dto: CreateInventoryDto = {
        ...mockInventory,
        blocks: 0
      };
      mockInventoryRepo.create.mockReturnValue(dto);
      mockInventoryRepo.save.mockRejectedValue(new Error('Database Error'));
      jest.spyOn(service['logger'], 'error');

      await expect(service.createInventory(dto)).rejects.toThrow('Error while saving inventory to the database');
      expect(service['logger'].error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save inventory: Database Error'),
        expect.anything()
      );
    });
  });

  describe('getInventoryById', () => {
    it('should return inventory by ID', async () => {
      jest.spyOn(service as any, 'findInventoryById').mockResolvedValue(mockInventory);

      const result = await service.getInventoryById('1');
      expect(result).toEqual(mockInventory);
    });
  });

  describe('updateInventory', () => {
    it('should update and save the inventory', async () => {
      const dto: UpdateInventoryDto = { status: 'updated' };
      const updatedInventory = { ...mockInventory, ...dto };

      jest.spyOn(service as any, 'findInventoryById').mockResolvedValue(mockInventory);
      mockInventoryRepo.save.mockResolvedValue(updatedInventory);

      const result = await service.updateInventory('1', dto);
      expect(result).toEqual(updatedInventory);
      expect(mockInventoryRepo.save).toHaveBeenCalledWith(updatedInventory);
    });

    it('should log an error and throw an exception if update fails', async () => {
      const dto: UpdateInventoryDto = { status: 'updated' };

      jest.spyOn(service as any, 'findInventoryById').mockResolvedValue(mockInventory);
      mockInventoryRepo.save.mockRejectedValue(new Error('Database Error'));
      jest.spyOn(service['logger'], 'error');

      await expect(service.updateInventory('1', dto)).rejects.toThrow('Error while updating inventory in the database');
      expect(service['logger'].error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update inventory: Database Error'),
        expect.anything()
      );
    });
  });

  describe('deleteInventory', () => {
    it('should delete the inventory and return a success message', async () => {
      jest.spyOn(service as any, 'findInventoryById').mockResolvedValue(mockInventory);
      mockInventoryRepo.remove.mockResolvedValue(mockInventory);

      const result = await service.deleteInventory('1');
      expect(result).toEqual({ message: `Inventory with ID 1 has been deleted` });
      expect(mockInventoryRepo.remove).toHaveBeenCalledWith(mockInventory);
    });

    it('should log an error and throw an exception if delete fails', async () => {
      jest.spyOn(service as any, 'findInventoryById').mockResolvedValue(mockInventory);
      mockInventoryRepo.remove.mockRejectedValue(new Error('Database Error'));
      jest.spyOn(service['logger'], 'error');

      await expect(service.deleteInventory('1')).rejects.toThrow('Error while deleting inventory from the database');
      expect(service['logger'].error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete inventory: Database Error'),
        expect.anything()
      );
    });
  });

  describe('getAllInventories', () => {
    it('should return all inventories', async () => {
      const mockInventories = [mockInventory, { ...mockInventory, id: '2' }];
      mockInventoryRepo.find.mockResolvedValue(mockInventories);

      const result = await service.getAllInventories();
      expect(result).toEqual(mockInventories);
      expect(mockInventoryRepo.find).toHaveBeenCalled();
    });

    it('should log an error and throw an exception if retrieval fails', async () => {
      mockInventoryRepo.find.mockRejectedValue(new Error('Database Error'));
      jest.spyOn(service['logger'], 'error');

      await expect(service.getAllInventories()).rejects.toThrow('Error while fetching inventories');
      expect(service['logger'].error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to retrieve inventories: Database Error'),
        expect.anything()
      );
    });
  });
});
