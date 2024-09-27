import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InventoryService } from './services/inventory.service';
import { RmqContext } from '@nestjs/microservices';

describe('AppController', () => {
  let appController: AppController;
  let inventoryService: InventoryService;

  const mockAppService = {
    getHello: jest.fn().mockReturnValue('Hello World!'),
  };

  const mockInventoryService = {
    createInventory: jest.fn(),
  };

  const mockRmqContext = {
    getChannelRef: jest.fn().mockReturnValue({
      ack: jest.fn(),
    }),
    getMessage: jest.fn().mockReturnValue({}),
  } as unknown as RmqContext;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: mockAppService,
        },
        {
          provide: InventoryService,
          useValue: mockInventoryService,
        },
      ],
    }).compile();

    appController = module.get<AppController>(AppController);
    inventoryService = module.get<InventoryService>(InventoryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getHello', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
      expect(mockAppService.getHello).toHaveBeenCalled();
    });
  });

  describe('handleMessage', () => {
    it('should handle the createInventory message', async () => {
      const messageData = JSON.stringify({ message: { mountPath: '/mnt/storage', fileName: 'file.txt' } });
      const payload = { message: messageData };

      await appController.handleMessage(payload.message, mockRmqContext);

      expect(inventoryService.createInventory).toHaveBeenCalledWith(JSON.parse(messageData).message);
      
      expect(mockRmqContext.getChannelRef().ack).toHaveBeenCalledWith(mockRmqContext.getMessage());
    });
  });
});
