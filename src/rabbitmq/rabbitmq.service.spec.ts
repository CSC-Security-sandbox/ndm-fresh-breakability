import { Test, TestingModule } from '@nestjs/testing';
import { RabbitMQService } from './rabbitmq.service';
import { RabbitMQConfigService } from '../config/rabbitmq.config';
import { ClientProxy, ClientProxyFactory } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';

describe('RabbitMQService', () => {
  let service: RabbitMQService;
  let clientProxyMock: ClientProxy;

  const mockRabbitMQConfigService = {
    uris: ['amqp://localhost:5672'],
    queueName: 'test_queue',
  };

  beforeEach(async () => {
    clientProxyMock = {
    connect: jest.fn().mockResolvedValue(true),
    send: jest.fn(),
    } as any;

    jest
      .spyOn(ClientProxyFactory, 'create')
      .mockReturnValue(clientProxyMock);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RabbitMQService,
        {
          provide: RabbitMQConfigService,
          useValue: mockRabbitMQConfigService,
        },
      ],
    }).compile();

    service = module.get<RabbitMQService>(RabbitMQService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a ClientProxy on initialization', () => {
    expect(ClientProxyFactory.create).toHaveBeenCalledWith({
      transport: expect.any(Number), // Transport.RMQ is a number internally
      options: {
        urls: mockRabbitMQConfigService.uris,
        queue: mockRabbitMQConfigService.queueName,
        queueOptions: {
          durable: true,
          arguments: {
            'x-queue-type': 'quorum',
          },
        },
      },
    });
  });

  describe('sendMessage', () => {
    it('should call client.connect and client.send', async () => {
      const message = 'test message';
  
      jest.spyOn(clientProxyMock, 'send').mockReturnValueOnce(of('Result')); // Simulate successful send
  
      await service.sendMessage(message);
  
      // Check if the client is connected
      expect(clientProxyMock.connect).toHaveBeenCalled();
  
      // Check if the send method was called with the correct pattern and message
      expect(clientProxyMock.send).toHaveBeenCalledWith('createInventory', message);
    });
  
    it('should log the correct message on successful send', async () => {
      const message = 'test message';
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  
      jest.spyOn(clientProxyMock, 'send').mockReturnValueOnce(of('Result')); // Simulate successful send
  
      await service.sendMessage(message);
  
      // Check that the message was logged correctly
      expect(consoleLogSpy).toHaveBeenCalledWith(
        `Sending message: ${message} to queue: ${mockRabbitMQConfigService.queueName}`,
      );
      expect(consoleLogSpy).toHaveBeenCalledWith('Result:', 'Result');
  
      consoleLogSpy.mockRestore();
    });
  
    it('should catch and log errors during message sending', async () => {
        const message = 'test message';
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  
        // Simulate an error thrown during send
        jest.spyOn(clientProxyMock, 'send').mockReturnValueOnce(
          throwError(() => new Error('Test Error'))
        );
  
        await service.sendMessage(message);
  
        // Ensure async processes complete
        await new Promise(setImmediate);
  
        // Check that the error was logged correctly
        expect(consoleErrorSpy).toHaveBeenCalledWith('Send error: Error: Test Error');
  
        consoleErrorSpy.mockRestore();
    });
  
    it('should catch and log errors during client.connect', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    // Simulate an error during connect
    jest.spyOn(clientProxyMock, 'connect').mockRejectedValueOnce(
        new Error('Connection Error')
    );

    const message = 'test message';
    await service.sendMessage(message);

    // Ensure async processes complete
    await new Promise(setImmediate);

    console.log("consoleErrorSpy value", consoleErrorSpy[0]);
    

    // Check that the error was logged correctly
    expect(consoleErrorSpy).toHaveBeenCalledWith(new Error('Connection Error'));

    consoleErrorSpy.mockRestore();
    });

  });
  
});
