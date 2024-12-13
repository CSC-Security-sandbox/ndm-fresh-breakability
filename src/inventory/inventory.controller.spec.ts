import { Test, TestingModule } from '@nestjs/testing';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

const mockInventoryService = {
  createInventory: jest.fn(),
  getInventoryById: jest.fn(),
  updateInventory: jest.fn(),
  deleteInventory: jest.fn(),
  getAllInventories: jest.fn(),
};

describe('InventoryController', () => {
  let controller: InventoryController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [
        { provide: InventoryService, useValue: mockInventoryService },
      ],
    }).compile();

    controller = module.get<InventoryController>(InventoryController);
  });

  it('should create an inventory', async () => {
    const dto = { fileName: 'file1.txt' } as any;
    const result = { id: '1', ...dto };
    mockInventoryService.createInventory.mockResolvedValue(result);

    expect(await controller.createInventory(dto)).toEqual(result);
    expect(mockInventoryService.createInventory).toHaveBeenCalledWith(dto);
  });

  it('should get inventory by ID', async () => {
    const result = { id: '1', fileName: 'file1.txt' };
    mockInventoryService.getInventoryById.mockResolvedValue(result);

    expect(await controller.getInventoryById('1')).toEqual(result);
    expect(mockInventoryService.getInventoryById).toHaveBeenCalledWith('1');
  });

  it('should update an inventory', async () => {
    const dto = { fileName: 'file2.txt' } as any;
    const result = { id: '1', ...dto };
    mockInventoryService.updateInventory.mockResolvedValue(result);

    expect(await controller.updateInventory('1', dto)).toEqual(result);
    expect(mockInventoryService.updateInventory).toHaveBeenCalledWith('1', dto);
  });

  it('should delete an inventory', async () => {
    const result = { message: 'Inventory with ID 1 has been deleted' };
    mockInventoryService.deleteInventory.mockResolvedValue(result);

    expect(await controller.deleteInventory('1')).toEqual(result);
    expect(mockInventoryService.deleteInventory).toHaveBeenCalledWith('1');
  });
});
