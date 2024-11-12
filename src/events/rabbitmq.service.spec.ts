import { Test, TestingModule } from '@nestjs/testing';
import { EventsGateway } from './events.gateway';
import amqp, { ChannelWrapper } from 'amqp-connection-manager';
import { ConfirmChannel } from 'amqplib';
import { RabbitMqService } from './rabbitmq.service';

jest.mock('amqp-connection-manager');

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
        { provide: EventsGateway, useValue: mockEventsGateway },
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

    it('should log an error if there is an issue during setup', async () => {
      mockChannelWrapper.addSetup.mockImplementationOnce(() => {
        throw new Error('Test Error');
      });

      const loggerErrorSpy = jest.spyOn(service['logger'], 'error');

      await service.onModuleInit();

      expect(loggerErrorSpy).toHaveBeenCalledWith('Error starting the consumer:', new Error('Test Error'));
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
  });
});
