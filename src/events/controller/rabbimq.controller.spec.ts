import { Test, TestingModule } from '@nestjs/testing';

import { EventsService } from 'src/events/service/events.service';
import { RmqContext } from '@nestjs/microservices';
import { RabbiMqController } from './rabbimq.controller';

const mockEventsService = {
  fetchPaths: jest.fn(),
};

const mockRmqContext = {
  getChannelRef: jest.fn().mockReturnValue({
    ack: jest.fn(),
  }),
  getMessage: jest.fn().mockReturnValue({
    content: Buffer.from(JSON.stringify({ configId: 'test-config-id' })),
  }),
};

describe('RabbiMqController', () => {
  let controller: RabbiMqController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RabbiMqController],
      providers: [{ provide: EventsService, useValue: mockEventsService }],
    }).compile();

    controller = module.get<RabbiMqController>(RabbiMqController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleMessage', () => {
    it('should call fetchPaths with the correct configId and acknowledge the message', async () => {
      const data = { configId: 'test-config-id' };
      const context = mockRmqContext as unknown as RmqContext;

      await controller.handleMessage(data, context);

      expect(mockEventsService.fetchPaths).toHaveBeenCalledWith('test-config-id');
      expect(context.getChannelRef().ack).toHaveBeenCalledWith(context.getMessage());
    });

    it('should handle errors in fetchPaths gracefully and not acknowledge the message', async () => {
      const data = { configId: 'test-config-id' };
      const context = mockRmqContext as unknown as RmqContext;
      mockEventsService.fetchPaths.mockRejectedValueOnce(new Error('Fetch error'));

      try {
        await controller.handleMessage(data, context);
      } catch (err) {
        expect(mockEventsService.fetchPaths).toHaveBeenCalledWith('test-config-id');
        expect(context.getChannelRef().ack).not.toHaveBeenCalled();
      }
    });
  });
});
