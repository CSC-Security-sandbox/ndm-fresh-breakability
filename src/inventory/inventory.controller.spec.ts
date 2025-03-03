import { Logger } from '@nestjs/common';
import { RmqContext } from '@nestjs/microservices';
import { Test, TestingModule } from '@nestjs/testing';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { InventoryPayload, InventoryPayloadType } from './inventory.type';

describe('InventoryController', () => {
  let controller: InventoryController;
  let service: InventoryService;

  // Mock services and dependencies
  const mockInventoryService = {
    operate: jest.fn(),
  };

  const mockChannel = {
    ack: jest.fn(),
    nack: jest.fn()
  };

  const mockRmqContext: Partial<RmqContext> = {
    getChannelRef: jest.fn().mockReturnValue(mockChannel),
    getMessage: jest.fn().mockReturnValue({}),
  };

  const payload: InventoryPayload = {
    type: InventoryPayloadType.DATA_INSERT,
    data: { key: 'value' },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [
        { provide: InventoryService, useValue: mockInventoryService },
      ],
    }).compile();

    controller = module.get<InventoryController>(InventoryController);
    service = module.get<InventoryService>(InventoryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should process the message successfully', async () => {
    mockInventoryService.operate.mockResolvedValueOnce(undefined);

    await controller.handleInventoryMessage(payload, mockRmqContext as RmqContext);

    expect(mockInventoryService.operate).toHaveBeenCalledWith(payload);
    expect(mockChannel.ack).toHaveBeenCalledWith(mockRmqContext.getMessage());
  });

  it('should handle errors during message processing', async () => {
    const error = new Error('Test error');
    mockInventoryService.operate.mockRejectedValueOnce(error);
    await controller.handleInventoryMessage(payload, mockRmqContext as RmqContext);
    expect(mockInventoryService.operate).toHaveBeenCalledWith(payload);
    expect(mockChannel.nack).toHaveBeenCalledWith(mockRmqContext.getMessage());

  });

  it('should log the payload', async () => {
    jest.spyOn(Logger.prototype, 'error');
    mockInventoryService.operate.mockResolvedValueOnce(undefined);
    await controller.handleInventoryMessage(payload, mockRmqContext as RmqContext);

  });


});
