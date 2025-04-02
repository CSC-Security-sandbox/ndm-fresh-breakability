import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from './redis.service';
import { RedisClientType } from 'redis';

jest.mock('redis');

describe('RedisService', () => {
  let service: RedisService;
  let client: RedisClientType;

  beforeEach(async () => {
    client = {
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      hGet: jest.fn(),
      set: jest.fn(),
      isOpen: true, // Simulate an open client
    } as unknown as RedisClientType;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: 'RedisClient',
          useValue: client,
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
    (service as any).client = client; // Mock the client
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });


  it('should disconnect Redis client on module destroy', async () => {
    await service.onModuleDestroy();
    expect(client.quit).toHaveBeenCalled();
  });

  it('should return the Redis client', () => {
    const result = service.getClient();
    expect(result).toBe(client);
  });

  it('should throw an error if client is not initialized', () => {
    (service as any).client = null; // Simulate uninitialized client
    expect(() => service.getClient()).toThrow('Redis client is not initialized yet.');
  });


  it('should set job context', async () => {
    const traceId = 'test-trace-id';
    const jobContext = { serialize: jest.fn().mockReturnValue('serialized') };
    (service as any).ensureClient = jest.fn().mockResolvedValue(undefined);
    (service as any).client = { set: jest.fn().mockResolvedValue(undefined) };

    await service.setJobContext(traceId, jobContext);
    expect((service as any).client.set).toHaveBeenCalledWith(traceId, 'serialized');
  });

  describe('onModuleInit', () => {
    it('should create a Redis client', async () => {
      const mockClient = {
        connect: jest.fn(),
        on: jest.fn(),
      };
      (service as any).createClient = jest.fn().mockResolvedValue(mockClient);
      await service.onModuleInit();
      expect((service as any).createClient).toHaveBeenCalled();
    });
  })
});
 