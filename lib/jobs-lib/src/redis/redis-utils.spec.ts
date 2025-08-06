import { RedisUtils } from './redis-utils';
import { createClient, RedisClientType } from 'redis';

jest.mock('redis', () => ({
  createClient: jest.fn(),
}));


describe('RedisUtils', () => {
  let mockClient: RedisClientType;

  beforeEach(() => {
    mockClient = {
      on: jest.fn(),
    } as unknown as RedisClientType;
    (createClient as jest.Mock).mockReturnValue(mockClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getClient', () => {
    it('should create a new client if one does not exist', async () => {
      await RedisUtils.getClient();
      expect(createClient).toHaveBeenCalled();
      expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith('connect', expect.any(Function));
    });

    it('should return the existing client if one exists', async () => {
      RedisUtils.client = mockClient;
      const client = await RedisUtils.getClient();
      expect(client).toBe(mockClient);
      expect(createClient).not.toHaveBeenCalled();
    });
  });

  describe('createClient', () => {
    it('should create a client with the correct options', async () => {
      process.env.REDIS_HOST = 'localhost';
      process.env.REDIS_PORT = '6380';
      process.env.REDIS_USERNAME = 'user';
      process.env.REDIS_PASSWORD = 'pass';

      await RedisUtils.createClient();

      expect(createClient).toHaveBeenCalledWith({
        url: 'redis://localhost:6380',
        username: 'user',
        password: 'pass',
      });
      expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith('connect', expect.any(Function));
    });

    it('should create a client with default options if env variables are not set', async () => {
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      delete process.env.REDIS_USERNAME;
      delete process.env.REDIS_PASSWORD;

      await RedisUtils.createClient();

      expect(createClient).toHaveBeenCalledWith({
        url: 'redis://127.0.0.1:6379',
      });
      expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockClient.on).toHaveBeenCalledWith('connect', expect.any(Function));
    });
  });
});
