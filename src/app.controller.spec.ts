import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InventoryService } from './services/inventory.service';
import { RmqContext } from '@nestjs/microservices';

describe('AppController', () => {
  let appController: AppController;
  let appService: AppService;
  let inventoryService: InventoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: { getHello: jest.fn().mockReturnValue('Hello World!') },
        },
        {
          provide: InventoryService,
          useValue: {
            createInventory: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    appController = module.get<AppController>(AppController);
    appService = module.get<AppService>(AppService);
    inventoryService = module.get<InventoryService>(InventoryService);
  });

  it('should return "Hello World!"', () => {
    expect(appController.getHello()).toBe('Hello World!');
  });

  describe('handleMessage', () => {
    let mockRmqContext: Partial<RmqContext>;

    beforeEach(() => {
      mockRmqContext = {
        getChannelRef: jest.fn().mockReturnValue({
          ack: jest.fn(), // Mock acknowledgment
        }),
        getMessage: jest.fn().mockReturnValue({}),
      };
    });

    it('should handle message and create inventory', async () => {
      const mockData = JSON.stringify({
        message: { name: 'Test Inventory', quantity: 10 },
      });

      await appController.handleMessage(mockData, mockRmqContext as RmqContext);

      expect(inventoryService.createInventory).toHaveBeenCalledWith({
        name: 'Test Inventory',
        quantity: 10,
      });

      // Check if the message was acknowledged
      const channelRef = mockRmqContext.getChannelRef as jest.Mock;
      expect(channelRef().ack).toHaveBeenCalled();
    });

    it('should log received message', async () => {
      console.log = jest.fn(); // Mock console.log

      const mockData = JSON.stringify({
        message: { name: 'Test Inventory', quantity: 10 },
      });

      await appController.handleMessage(mockData, mockRmqContext as RmqContext);

      expect(console.log).toHaveBeenCalledWith('Received message:', mockData);
      expect(console.log).toHaveBeenCalledWith('created invetory');
    });
  });
});
