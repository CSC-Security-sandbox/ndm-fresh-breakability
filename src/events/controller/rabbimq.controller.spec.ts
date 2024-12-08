import { Test, TestingModule } from '@nestjs/testing';
import { RmqContext } from '@nestjs/microservices';
import { RabbiMqController } from './rabbimq.controller';
import { ListPathsMsg } from './rabbitmq.types';
import { Protocol } from 'src/constants/enums';
import { EventsService } from '../service/events/events.service';

const mockEventsService = {
  fetchPathsByCred: jest.fn(),
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

  const ListPathsMsg: ListPathsMsg = {
    configId: 'config-123',
    credentials: [
      {
        protocol: Protocol.NFS,
        details: {
          hostname: 'localhost',
          username: 'user',
          password: 'pass',
        },
        workers: ['worker-1'],
      },
    ],
  };
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

      await controller.handleMessage(ListPathsMsg, context);

      expect(mockEventsService.fetchPathsByCred).toHaveBeenCalledWith(ListPathsMsg);
      expect(context.getChannelRef().ack).toHaveBeenCalledWith(context.getMessage());
    });

    it('should handle errors in fetchPaths gracefully and not acknowledge the message', async () => {
      const data = { configId: 'test-config-id' };
      const context = mockRmqContext as unknown as RmqContext;
      mockEventsService.fetchPathsByCred.mockRejectedValueOnce(new Error('Fetch error'));

      try {
        await controller.handleMessage(ListPathsMsg, context);
      } catch (err) {
        expect(mockEventsService.fetchPathsByCred).toHaveBeenCalledWith(ListPathsMsg);
        expect(context.getChannelRef().ack).not.toHaveBeenCalled();
      }
    });
  });
});
