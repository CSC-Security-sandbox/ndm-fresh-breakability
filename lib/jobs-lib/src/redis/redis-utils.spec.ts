import { RedisUtils } from './redis-utils';
import { createClient } from 'redis';
import * as genericPool from 'generic-pool';

// Mock redis and generic-pool
jest.mock('redis');
jest.mock('generic-pool');

describe('RedisUtils', () => {
  let redisUtils: RedisUtils;
  let mockClient: any;
  let mockPool: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock Redis client
    mockClient = {
      isOpen: true,
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    };

    // Mock createClient to return our mock client
    (createClient as jest.Mock).mockReturnValue(mockClient);

    // Mock pool
    mockPool = {
      acquire: jest.fn().mockResolvedValue(mockClient),
      release: jest.fn().mockResolvedValue(undefined),
      drain: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
      size: 5,
      borrowed: 2,
      available: 3,
      pending: 0,
    };

    // Mock createPool to return our mock pool
    (genericPool.createPool as jest.Mock).mockReturnValue(mockPool);

    // Create instance
    redisUtils = new RedisUtils();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const utils = new RedisUtils();
      expect(utils).toBeDefined();
    });

    it('should initialize with custom options', () => {
      const customOptions = {
        minConnections: 10,
        maxConnections: 50,
        acquireTimeout: 10000,
        idleTimeout: 60000,
      };
      const utils = new RedisUtils(customOptions);
      expect(utils).toBeDefined();
    });
  });

  describe('initializePool', () => {
    it('should create pool with correct configuration', async () => {
      await redisUtils.initializePool();

      expect(genericPool.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.any(Function),
          destroy: expect.any(Function),
          validate: expect.any(Function),
        }),
        expect.objectContaining({
          min: 5,
          max: 20,
          acquireTimeoutMillis: 5000,
          idleTimeoutMillis: 30000,
          testOnBorrow: true,
          evictionRunIntervalMillis: 10000,
          numTestsPerEvictionRun: 3,
        })
      );
    });

    it('should pre-create minimum connections', async () => {
      await redisUtils.initializePool();
      
      // Should acquire and release min connections (5 times by default)
      expect(mockPool.acquire).toHaveBeenCalledTimes(5);
      expect(mockPool.release).toHaveBeenCalledTimes(5);
    });

    it('should not reinitialize if pool already exists', async () => {
      await redisUtils.initializePool();
      const firstCallCount = (genericPool.createPool as jest.Mock).mock.calls.length;
      
      await redisUtils.initializePool();
      const secondCallCount = (genericPool.createPool as jest.Mock).mock.calls.length;
      
      expect(firstCallCount).toBe(secondCallCount);
    });
  });

  describe('getClient', () => {
    it('should initialize pool if not already initialized', async () => {
      await redisUtils.getClient();
      expect(genericPool.createPool).toHaveBeenCalled();
    });

    it('should acquire client from pool', async () => {
      await redisUtils.initializePool();
      const client = await redisUtils.getClient();
      
      expect(mockPool.acquire).toHaveBeenCalled();
      expect(client).toBe(mockClient);
    });
  });

  describe('releaseClient', () => {
    it('should release client back to pool', async () => {
      await redisUtils.initializePool();
      await redisUtils.releaseClient(mockClient);
      
      expect(mockPool.release).toHaveBeenCalledWith(mockClient);
    });

    it('should warn if pool not initialized', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      await redisUtils.releaseClient(mockClient);
      
      expect(consoleWarnSpy).toHaveBeenCalledWith('Pool not initialized');
      consoleWarnSpy.mockRestore();
    });
  });

  describe('closePool', () => {
    it('should drain and clear pool', async () => {
      await redisUtils.initializePool();
      await redisUtils.closePool();
      
      expect(mockPool.drain).toHaveBeenCalled();
      expect(mockPool.clear).toHaveBeenCalled();
    });

    it('should handle closing when pool not initialized', async () => {
      await expect(redisUtils.closePool()).resolves.not.toThrow();
    });
  });

  describe('factory methods', () => {
    let factory: any;

    beforeEach(async () => {
      await redisUtils.initializePool();
      factory = (genericPool.createPool as jest.Mock).mock.calls[0][0];
    });

    describe('create', () => {
      it('should create redis client with correct configuration', async () => {
        process.env.REDIS_HOST = 'test-host';
        process.env.REDIS_PORT = '6380';
        
        await factory.create();
        
        expect(createClient).toHaveBeenCalledWith(
          expect.objectContaining({
            url: 'redis://test-host:6380',
            socket: expect.objectContaining({
              reconnectStrategy: expect.any(Function),
            }),
          })
        );
      });

      it('should add auth when credentials provided', async () => {
        process.env.REDIS_USERNAME = 'testuser';
        process.env.REDIS_PASSWORD = 'testpass';
        
        await factory.create();
        
        expect(createClient).toHaveBeenCalledWith(
          expect.objectContaining({
            username: 'testuser',
            password: 'testpass',
          })
        );
      });

      it('should setup event listeners', async () => {
        await factory.create();
        
        expect(mockClient.on).toHaveBeenCalledWith('error', expect.any(Function));
        expect(mockClient.on).toHaveBeenCalledWith('connect', expect.any(Function));
        expect(mockClient.on).toHaveBeenCalledWith('ready', expect.any(Function));
      });

      it('should connect the client', async () => {
        await factory.create();
        expect(mockClient.connect).toHaveBeenCalled();
      });
    });

    describe('destroy', () => {
      it('should quit client if open', async () => {
        mockClient.isOpen = true;
        await factory.destroy(mockClient);
        expect(mockClient.quit).toHaveBeenCalled();
      });

      it('should not quit client if closed', async () => {
        mockClient.isOpen = false;
        await factory.destroy(mockClient);
        expect(mockClient.quit).not.toHaveBeenCalled();
      });

      it('should handle errors gracefully', async () => {
        mockClient.quit.mockRejectedValue(new Error('Quit failed'));
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        
        await factory.destroy(mockClient);
        
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Error destroying Redis client:',
          expect.any(Error)
        );
        consoleErrorSpy.mockRestore();
      });
    });

    describe('validate', () => {
      it('should return true for open client', async () => {
        mockClient.isOpen = true;
        const result = await factory.validate(mockClient);
        expect(result).toBe(true);
      });

      it('should return false for closed client', async () => {
        mockClient.isOpen = false;
        const result = await factory.validate(mockClient);
        expect(result).toBe(false);
      });
    });
  });


  // Cleanup
  afterEach(() => {
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    delete process.env.REDIS_USERNAME;
    delete process.env.REDIS_PASSWORD;
  });
});
