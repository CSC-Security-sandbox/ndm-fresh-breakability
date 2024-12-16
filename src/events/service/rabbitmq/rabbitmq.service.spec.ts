import { Test, TestingModule } from '@nestjs/testing';
import amqp, { ChannelWrapper } from 'amqp-connection-manager';
import { ConfirmChannel } from 'amqplib';
import { RabbitMqService } from './rabbitmq.service';
import { EventsGateway } from 'src/events/getway/events.gateway';
import { ConfigService } from '@nestjs/config';
import { InventoryPayloadType, InventoryQueueEvents } from 'src/constants/events';

jest.mock('amqp-connection-manager');
const mockClientProxy = {
  emit: jest.fn().mockReturnValue({ toPromise: jest.fn().mockResolvedValue(undefined) }),
};
jest.mock('@nestjs/microservices', () => ({
  ClientProxyFactory: {
    create: jest.fn(() => mockClientProxy),
  },
  Transport: {
    RMQ: 'RMQ',
  },
}));

const mockConfigService = {
  get: jest.fn((key) => {
    if (key === 'app.rabbitmq.urls') return ['amqp://localhost'];
    if (key === 'app.rabbitmq.inventoryQueue') return 'inventory_queue';
    return undefined;
  }),
};

describe('RabbitMqService', () => {
  let service: RabbitMqService;
  let mockChannelWrapper: jest.Mocked<ChannelWrapper>;
  let mockEventsGateway: jest.Mocked<EventsGateway>;

  beforeEach(async () => {
    mockChannelWrapper = {
      addSetup: jest.fn(),
      publish: jest.fn(),
    } as unknown as jest.Mocked<ChannelWrapper>;

    (amqp.connect as jest.Mock).mockReturnValue({
      createChannel: jest.fn(() => mockChannelWrapper),
    });


    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RabbitMqService,
        { provide: EventsGateway, useValue: {sendToClient : jest.fn()} },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<RabbitMqService>(RabbitMqService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should initialize the RabbitMQ connection and set up the queue', async () => {
      const mockChannel = {
        assertExchange: jest.fn(),
        assertQueue: jest.fn(),
        bindQueue: jest.fn(),
        consume: jest.fn(),
        ack: jest.fn(),
      } as unknown as jest.Mocked<ConfirmChannel>;

      mockChannelWrapper.addSetup.mockImplementationOnce((callback) => mockChannel);

      await service.onModuleInit();

      expect(mockChannel.assertExchange).toBeDefined();
      expect(mockChannel.assertQueue).toBeDefined();
      expect(mockChannel.bindQueue).toBeDefined();
      expect(mockChannel.consume).toBeDefined();
    });

    it('should initialize the queue and consume messages', async () => {
      const mockChannel = {
        assertExchange: jest.fn(),
        assertQueue: jest.fn(),
        bindQueue: jest.fn(),
        consume: jest.fn((queue, callback) => {
          const message = { content: Buffer.from(JSON.stringify({ workerId: '123', action: { eventType: 'testEvent', message: 'testMessage' } })) };
          callback(message);
        }),
        ack: jest.fn(),
      } as unknown as ConfirmChannel;

      mockChannelWrapper.addSetup.mockImplementation(async (setupFn: any) => {
        await setupFn(mockChannel);
      });

      await service.onModuleInit();

      expect(mockChannel.assertExchange).toHaveBeenCalledWith('defaultEX', 'fanout', { durable: true });
      expect(mockChannel.assertQueue).toHaveBeenCalledWith(expect.stringContaining('worker_notification_queue_'), { durable: true });
      expect(mockChannel.bindQueue).toHaveBeenCalledWith(expect.any(String), 'defaultEX', 'socketConnetion');
      expect(mockChannel.consume).toHaveBeenCalledWith(expect.any(String), expect.any(Function));
      expect(mockChannel.ack).toHaveBeenCalled();
      // expect(mockEventsGateway.sendToClient).toHaveBeenCalledWith('123', 'testEvent', 'testMessage');
    });

    it('should log an error if there is an issue during setup', async () => {
      mockChannelWrapper.addSetup.mockImplementationOnce(() => {
        throw new Error('Test Error');
      });

      const loggerErrorSpy = jest.spyOn(service['logger'], 'error');

      await service.onModuleInit();

      expect(loggerErrorSpy).toHaveBeenCalledWith('Error starting the consumer:', new Error('Test Error'));
    });


    it('should log an error if setup fails', async () => {
      const error = new Error('Setup failed');
      mockChannelWrapper.addSetup.mockRejectedValue(error);
      await service.onModuleInit();
    });
  });

  describe('publishToExchange', () => {
    it('should publish a message to the exchange', async () => {
      const message = { test: 'message' };
      await service.publishToExchange(message);

      expect(mockChannelWrapper.publish).toHaveBeenCalledWith(
        'defaultEX',
        'socketConnetion',
        Buffer.from(JSON.stringify(message)),
        { persistent: true }
      );
    });

    it('should log an error if there is an issue publishing a message', async () => {
      const loggerErrorSpy = jest.spyOn(service['logger'], 'error');
      mockChannelWrapper.publish.mockImplementationOnce(() => {
        throw new Error('Publish Error');
      });

      await service.publishToExchange({});

      expect(loggerErrorSpy).toHaveBeenCalledWith('Error publishing message:', new Error('Publish Error'));
    });
  });

  describe('onModuleDestroy', () => {
    it('should unbind and delete the queue on module destroy', async () => {
      const mockChannel = {
        unbindQueue: jest.fn(),
        deleteQueue: jest.fn(),
      } as unknown as jest.Mocked<ConfirmChannel>;

      mockChannelWrapper.addSetup.mockImplementationOnce((callback) => mockChannel);

      await service.onModuleDestroy();

      expect(mockChannel.unbindQueue).toBeDefined();
      expect(mockChannel.deleteQueue).toBeDefined();
    });

    it('should log an error if there is an issue unbinding or deleting the queue', async () => {
      const loggerErrorSpy = jest.spyOn(service['logger'], 'error');
      mockChannelWrapper.addSetup.mockImplementationOnce(() => {
        throw new Error('Unbind/Delete Error');
      });

      await service.onModuleDestroy();

      expect(loggerErrorSpy).toHaveBeenCalledWith('Error unbinding or deleting queue:', new Error('Unbind/Delete Error'));
    });

    it('should unbind and delete the queue', async () => {
      const mockChannel = {
        unbindQueue: jest.fn(),
        deleteQueue: jest.fn(),
      } as unknown as ConfirmChannel;

      mockChannelWrapper.addSetup.mockImplementation(async (setupFn: any) => {
        await setupFn(mockChannel);
      });

      await service.onModuleDestroy();

      expect(mockChannel.unbindQueue).toHaveBeenCalledWith(expect.any(String), 'defaultEX', 'socketConnetion');
      expect(mockChannel.deleteQueue).toHaveBeenCalledWith(expect.any(String));
    });

    it('should log an error if unbinding or deleting fails', async () => {
      const error = new Error('Unbind/Delete failed');
      mockChannelWrapper.addSetup.mockRejectedValue(error);

      await service.onModuleDestroy();

     
    });

    it('should handle partial failures during cleanup', async () => {
      const mockChannel = {
        unbindQueue: jest.fn().mockResolvedValue(undefined),
        deleteQueue: jest.fn().mockRejectedValue(new Error('Delete failed')),
      } as unknown as ConfirmChannel;

      mockChannelWrapper.addSetup.mockImplementation(async (setupFn: any) => {
        await setupFn(mockChannel);
      });

      await service.onModuleDestroy();

      expect(mockChannel.unbindQueue).toHaveBeenCalled();
     
    });
 
  });

  describe('generateDiscoveryReport', () => {
    it('should emit a discovery complete event', async () => {

      await service.generateDiscoveryReport({jobRunId: '132'});

      expect(mockClientProxy.emit).toHaveBeenCalledWith(InventoryQueueEvents.INVENTORY, {
        type: InventoryPayloadType.DISCOVERY_COMPLETED,
        data: {jobRunId: '132'},
      });
    });
  });
});
