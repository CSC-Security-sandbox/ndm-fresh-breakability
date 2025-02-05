import { RedisStreamCollection } from './redis-stream-collection';
import { RedisClientType } from 'redis';
import { Logger } from '../utils/logging';
import { encode } from 'msgpack-lite';

jest.mock('redis');
jest.mock('../utils/logging');

describe('RedisStreamCollection', () => {
  let redisClient: jest.Mocked<RedisClientType>;
  let logger: jest.Mocked<Logger>;
  let collection: RedisStreamCollection<any>;

  beforeEach(() => {
    redisClient = {
      exists: jest.fn(),
      xGroupCreate: jest.fn(),
      del: jest.fn(),
      xAdd: jest.fn(),
      xRead: jest.fn(),
      xReadGroup: jest.fn(),
      xAck: jest.fn(),
      xInfoGroups: jest.fn(),
    } as any;

    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    Logger.getLogger = jest.fn().mockReturnValue(logger);

    collection = new RedisStreamCollection(
      'jobRunId',
      'streamKey',
      0,
      '0-0',
      redisClient,
    );
  });

  describe('init', () => {
    it('should initialize the collection', async () => {
      redisClient.exists.mockResolvedValue(1);
      redisClient.xGroupCreate.mockResolvedValue('OK');

      await collection.init();

      expect(redisClient.exists).toHaveBeenCalledWith('streamKey');
      expect(redisClient.del).toHaveBeenCalledWith('streamKey');
      expect(redisClient.xGroupCreate).toHaveBeenCalledWith(
        'streamKey',
        'jobRunId',
        '0',
        { MKSTREAM: true },
      );
      expect(logger.info).toHaveBeenCalledWith(
        'Consumer group jobRunId created for stream : streamKey',
      );
    });

    it('should handle BUSYGROUP error', async () => {
      redisClient.exists.mockResolvedValue(0);
      redisClient.xGroupCreate.mockRejectedValue(new Error('BUSYGROUP'));

      await collection.init();

      expect(logger.warn).toHaveBeenCalledWith(
        'Consumer group jobRunId already exists',
      );
    });
  });

  describe('cleanup', () => {
    it('should clean up the stream', async () => {
      await collection.cleanup();

      expect(redisClient.del).toHaveBeenCalledWith('streamKey');
      expect(logger.info).toHaveBeenCalledWith('Cleaning up stream streamKey');
    });
  });

  describe('close', () => {
    it('should log closing collection', async () => {
      await collection.close();

      expect(logger.info).toHaveBeenCalledWith('Closing collection streamKey');
    });
  });

  describe('append', () => {
    it('should append a record to the stream', async () => {
      const record = { foo: 'bar' };
      const encodedRecord = encode(record).toString('base64')
      redisClient.xAdd.mockResolvedValue('1-0');

      const id = await collection.append(record);

      expect(redisClient.xAdd).toHaveBeenCalledWith('streamKey', '*', {
        obj: encodedRecord,
      });
      expect(collection.numMessages).toBe(1);
      expect(collection.lastId).toBe('1-0');
      expect(id).toBe('1-0');
    });

    it('should handle errors when appending a record', async () => {
      const record = { foo: 'bar' };
      const error = new Error('append error');
      redisClient.xAdd.mockRejectedValue(error);

      await expect(collection.append(record)).rejects.toThrow('append error');
      expect(logger.error).toHaveBeenCalledWith(
        'Error writing record: Error: append error',
        error,
      );
    });
  });

  describe('read', () => {
    it('should read messages from the stream', async () => {
      const record = { foo: 'bar' };
      const encodedRecord = encode(record).toString('base64');
      redisClient.xRead.mockResolvedValue([
        {
          key: 'streamKey',
          messages: [{ id: '1-0', message: { obj: encodedRecord } }],
        },
      ]);

      const messages = [];
      for await (const msg of collection.read('readerName')) {
        messages.push(msg);
        break;
      }

      expect(messages).toEqual([record]);
      expect(logger.info).toHaveBeenCalledWith(
        'Reading stream: streamKey, jobRunId, readerName',
      );
    });
  });

  describe('groupRead', () => {
    it('should read messages from the stream group', async () => {
      const record = { foo: 'bar' };
      const encodedRecord = encode(record).toString('base64');
      redisClient.xReadGroup.mockResolvedValue([
        {
          key: 'streamKey',
          messages: [{ id: '1-0', message: { obj: encodedRecord } }],
        },
      ]);
      redisClient.xInfoGroups.mockResolvedValue([
        { name: 'jobRunId', lastDeliveredId: '1-0' },
      ]);

      const messages = [];
      for await (const msg of collection.groupRead('readerName',1)) {
        messages.push(msg);
        break;
      }

      expect(messages).toEqual([record]);
      expect(logger.info).toHaveBeenCalledWith(
        'Reading stream: streamKey, jobRunId, readerName',
      );
    });
  });

  describe('groupReadNoResults', () => {
    it('should return no results and invoke else block', async () => {
      redisClient.xReadGroup.mockResolvedValue(null);
      redisClient.xInfoGroups.mockResolvedValue([
        { name: 'jobRunId', lastDeliveredId: '0-0' },
      ]);

      const messages = [];
      for await (const msg of collection.groupRead('readerName',10)) {
        messages.push(msg);
        break;
      }

      //expect(message).toEqual({});
      expect(logger.info).toHaveBeenCalledWith(
        'Reading stream: streamKey, jobRunId, readerName',
      );
      expect(logger.info).toHaveBeenCalledWith('>> No results');

    });
  });  
});