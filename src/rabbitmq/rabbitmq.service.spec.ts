import { Test, TestingModule } from '@nestjs/testing';
import { RabbitMQService } from './rabbitmq.service'; // Adjust the import to your file path
import { ConfigService } from '@nestjs/config';
import { ClientProxy, ClientProxyFactory, Transport } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';

jest.mock('@nestjs/microservices', () => ({
  ...jest.requireActual('@nestjs/microservices'),
  ClientProxyFactory: {
    create: jest.fn(),
  },
}));

describe('RabbitMQService', () => {
  let service: RabbitMQService;
  let configService: ConfigService;
  let mockClientProxy: ClientProxy;

  beforeEach(async () => {
    mockClientProxy = {
      connect: jest.fn(),
      send: jest.fn(() => ({
        forEach: jest.fn((callback) => callback('Mock Result')),
        catch: jest.fn(),
      })),
    } as any;

    (ClientProxyFactory.create as jest.Mock).mockReturnValue(mockClientProxy);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RabbitMQService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key) => {
              const mockConfig = {
                'app.rabbitmq.urls': ['amqp://localhost'],
                'app.rabbitmq.queue': 'test-queue',
                'app.rabbitmq.durable': true,
              };
              return mockConfig[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<RabbitMQService>(RabbitMQService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should initialize the RabbitMQ client with correct options', () => {
    const expectedOptions = {
      transport: Transport.RMQ,
      options: {
        urls: ['amqp://localhost'],
        queue: 'test-queue',
        queueOptions: {
          durable: true,
          arguments: {
            'x-queue-type': 'quorum',
          },
        },
      },
    };

    expect(ClientProxyFactory.create).toHaveBeenCalledWith(expectedOptions);
  });

  it('should send a message successfully', async () => {
    jest.spyOn(mockClientProxy, 'connect').mockResolvedValueOnce(undefined);

    const mockEvent = 'test-event';
    const mockMessage = { key: 'value' };

    await service.sendMessage(mockEvent, mockMessage);

    expect(mockClientProxy.connect).toHaveBeenCalled();
    expect(mockClientProxy.send).toHaveBeenCalledWith(mockEvent, mockMessage);
  });

  it('should log an error if sending a message fails', async () => {
    jest.spyOn(mockClientProxy, 'connect').mockRejectedValueOnce(new Error('Connection Error'));
    const loggerErrorSpy = jest.spyOn(Logger, 'error');

    const mockEvent = 'test-event';
    const mockMessage = { key: 'value' };

    await service.sendMessage(mockEvent, mockMessage);

    expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error while sending message :'));
  });
});
