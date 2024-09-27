import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InventoryService } from './inventory.service';
import { InventoryEntity } from '../entities/inventory.entity';
import { createInventoryDTO } from '../dto/create-inventory.dto';

describe('InventoryService', () => {
  let service: InventoryService;
  let repository: jest.Mocked<Repository<InventoryEntity>>;

  const mockInventoryRepository = () => ({
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    remove: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: mockInventoryRepository(),
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    repository = module.get(getRepositoryToken(InventoryEntity));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createInventory', () => {
    it('should create and save a new inventory record with metadata', async () => {
      const dto: createInventoryDTO = {
        mountPath: '/mnt/storage',
        fileServer: 'server1',
        fileName: 'file.txt',
        folder: true,
        metadata: {
          uid: 1000,
          gid: 1000,
          blksize: 4096,
          size: 1024,
          blocks: 8,
          atime: '2024-01-01T00:00:00Z',
          mtime: '2024-01-01T00:00:00Z',
          ctime: '2024-01-01T00:00:00Z',
          birthtime: '2024-01-01T00:00:00Z',
          fileName: 'file.txt',
          filePath: '/mnt/storage/file.txt',
          extension: '.txt',
          type: 'file',
          folder: false,
          permission: 'rw-r--r--',
        },
      };

      const expectedInventory = { ...dto, id: '1', metadata: JSON.stringify(dto.metadata) };

      repository.create.mockReturnValue(expectedInventory as any);
      repository.save.mockResolvedValue(expectedInventory);

      const result = await service.createInventory(dto);

      expect(repository.create).toHaveBeenCalledWith({
        mountPath: dto.mountPath,
        fileServer: dto.fileServer,
        fileName: dto.fileName,
        folder: dto.folder,
        metadata: JSON.stringify(dto.metadata),
      });
      expect(repository.save).toHaveBeenCalledWith(expectedInventory);
      expect(result).toEqual(expectedInventory);
    });
  });

  describe('getInventoryById', () => {
    it('should return an inventory record with metadata if it exists', async () => {
      const inventoryId = '1';
      const expectedInventory = {
        id: inventoryId,
        mountPath: '/mnt/storage',
        fileServer: 'server1',
        fileName: 'file.txt',
        folder: true,
        metadata: JSON.stringify({
          uid: 1000,
          gid: 1000,
          blksize: 4096,
          size: 1024,
          blocks: 8,
          atime: '2024-01-01T00:00:00Z',
          mtime: '2024-01-01T00:00:00Z',
          ctime: '2024-01-01T00:00:00Z',
          birthtime: '2024-01-01T00:00:00Z',
          fileName: 'file.txt',
          filePath: '/mnt/storage/file.txt',
          extension: '.txt',
          type: 'file',
          folder: false,
          permission: 'rw-r--r--',
        }),
      };

      repository.findOne.mockResolvedValue(expectedInventory);

      const result = await service.getInventoryById(inventoryId);

      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: inventoryId } });
      expect(result).toEqual(expectedInventory);
    });

    it('should throw an error if the inventory record does not exist', async () => {
      const inventoryId = '1';

      repository.findOne.mockResolvedValue(null);

      await expect(service.getInventoryById(inventoryId)).rejects.toThrowError(
        new Error(`Inventory with id ${inventoryId} not found`),
      );
    });
  });

  describe('updateInventory', () => {
    it('should update and return the inventory record with metadata', async () => {
      const inventoryId = '1';
      const existingInventory = {
        id: inventoryId,
        mountPath: '/mnt/storage',
        fileServer: 'server1',
        fileName: 'file.txt',
        folder: true,
        metadata: JSON.stringify({
          uid: 1000,
          gid: 1000,
          blksize: 4096,
          size: 1024,
          blocks: 8,
          atime: '2024-01-01T00:00:00Z',
          mtime: '2024-01-01T00:00:00Z',
          ctime: '2024-01-01T00:00:00Z',
          birthtime: '2024-01-01T00:00:00Z',
          fileName: 'file.txt',
          filePath: '/mnt/storage/file.txt',
          extension: '.txt',
          type: 'file',
          folder: false,
          permission: 'rw-r--r--',
        }),
      };

      const updateDTO: createInventoryDTO = {
        mountPath: '/mnt/new_storage',
        fileServer: 'server2',
        fileName: 'new_file.txt',
        folder: true,
        metadata: {
          uid: 1001,
          gid: 1001,
          blksize: 8192,
          size: 2048,
          blocks: 16,
          atime: '2024-02-01T00:00:00Z',
          mtime: '2024-02-01T00:00:00Z',
          ctime: '2024-02-01T00:00:00Z',
          birthtime: '2024-02-01T00:00:00Z',
          fileName: 'new_file.txt',
          filePath: '/mnt/new_storage/new_file.txt',
          extension: '.txt',
          type: 'file',
          folder: false,
          permission: 'rw-r--r--',
        },
      };

      repository.findOne.mockResolvedValue(existingInventory);
      repository.save.mockResolvedValue({ ...existingInventory, ...updateDTO, metadata: JSON.stringify(updateDTO.metadata) });

      const result = await service.updateInventory(inventoryId, updateDTO);

      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: inventoryId } });
      expect(repository.save).toHaveBeenCalledWith({
        ...existingInventory,
        mountPath: updateDTO.mountPath,
        fileServer: updateDTO.fileServer,
        fileName: updateDTO.fileName,
        folder: updateDTO.folder,
        metadata: JSON.stringify(updateDTO.metadata),
      });
      expect(result).toEqual({
        ...existingInventory,
        ...updateDTO,
        metadata: JSON.stringify(updateDTO.metadata),
      });
    });

    it('should throw an error if the inventory record does not exist', async () => {
      const inventoryId = '1';
      const updateDTO = {
        mountPath: '/mnt/new_storage',
        fileServer: 'server2',
        fileName: 'new_file.txt',
        folder: true,
        metadata: {
          uid: 1001,
          gid: 1001,
          blksize: 8192,
          size: 2048,
          blocks: 16,
          atime: '2024-02-01T00:00:00Z',
          mtime: '2024-02-01T00:00:00Z',
          ctime: '2024-02-01T00:00:00Z',
          birthtime: '2024-02-01T00:00:00Z',
          fileName: 'new_file.txt',
          filePath: '/mnt/new_storage/new_file.txt',
          extension: '.txt',
          type: 'file',
          folder: false,
          permission: 'rw-r--r--',
        },
      };

      repository.findOne.mockResolvedValue(null);

      await expect(service.updateInventory(inventoryId, updateDTO)).rejects.toThrowError(
        new Error(`Inventory with id ${inventoryId} not found`),
      );
    });
  });

  describe('deleteInventory', () => {
    it('should delete an inventory record', async () => {
      const inventoryId = '1';
      const existingInventory = {
        id: inventoryId,
        mountPath: '/mnt/storage',
        fileServer: 'server1',
        fileName: 'file.txt',
        folder: true,
        metadata: JSON.stringify({
          uid: 1000,
          gid: 1000,
          blksize: 4096,
          size: 1024,
          blocks: 8,
          atime: '2024-01-01T00:00:00Z',
          mtime: '2024-01-01T00:00:00Z',
          ctime: '2024-01-01T00:00:00Z',
          birthtime: '2024-01-01T00:00:00Z',
          fileName: 'file.txt',
          filePath: '/mnt/storage/file.txt',
          extension: '.txt',
          type: 'file',
          folder: false,
          permission: 'rw-r--r--',
        }),
      };

      repository.findOne.mockResolvedValue(existingInventory);
      repository.remove.mockResolvedValue(existingInventory);

      const result = await service.deleteInventory(inventoryId);

      expect(repository.findOne).toHaveBeenCalledWith({ where: { id: inventoryId } });
      expect(repository.remove).toHaveBeenCalledWith(existingInventory);
      expect(result).toEqual({ message: `Inventory with id ${inventoryId} has been deleted` });
    });

    it('should throw an error if the inventory record does not exist', async () => {
      const inventoryId = '1';

      repository.findOne.mockResolvedValue(null);

      await expect(service.deleteInventory(inventoryId)).rejects.toThrowError(
        new Error(`Inventory with id ${inventoryId} not found`),
      );
    });
  });

  describe('getAllInventories', () => {
    it('should return a list of all inventories', async () => {
      const inventories = [
        {
          id: '1',
          mountPath: '/mnt/storage',
          fileServer: 'server1',
          fileName: 'file.txt',
          folder: true,
          metadata: JSON.stringify({
            uid: 1000,
            gid: 1000,
            blksize: 4096,
            size: 1024,
            blocks: 8,
            atime: '2024-01-01T00:00:00Z',
            mtime: '2024-01-01T00:00:00Z',
            ctime: '2024-01-01T00:00:00Z',
            birthtime: '2024-01-01T00:00:00Z',
            fileName: 'file.txt',
            filePath: '/mnt/storage/file.txt',
            extension: '.txt',
            type: 'file',
            folder: false,
            permission: 'rw-r--r--',
          }),
        },
        {
          id: '2',
          mountPath: '/mnt/storage2',
          fileServer: 'server2',
          fileName: 'file2.txt',
          folder: false,
          metadata: JSON.stringify({
            uid: 1001,
            gid: 1001,
            blksize: 8192,
            size: 2048,
            blocks: 16,
            atime: '2024-02-01T00:00:00Z',
            mtime: '2024-02-01T00:00:00Z',
            ctime: '2024-02-01T00:00:00Z',
            birthtime: '2024-02-01T00:00:00Z',
            fileName: 'file2.txt',
            filePath: '/mnt/storage2/file2.txt',
            extension: '.txt',
            type: 'file',
            folder: false,
            permission: 'rw-r--r--',
          }),
        },
      ];

      repository.find.mockResolvedValue(inventories);

      const result = await service.getAllInventories();

      expect(repository.find).toHaveBeenCalled();
      expect(result).toEqual(inventories);
    });
  });
});


