import { RedisStreamCollection } from './redis-stream-collection';
import { GroupReaderType } from '../types/enums';
import { encode } from 'msgpack-lite';
import { Serializable } from '../types/serializable';

const mockRedis = {
  exists: jest.fn(),
  xGroupCreate: jest.fn(),
  xGroupDestroy: jest.fn(),
  del: jest.fn(),
  xAdd: jest.fn(),
  xRead: jest.fn(),
  xReadGroup: jest.fn(),
  xAck: jest.fn(),
  xDel: jest.fn(),
  hIncrBy: jest.fn(),
  hDel: jest.fn(),
  set: jest.fn(),
  get: jest.fn(),
  xAutoClaim: jest.fn(), // Added missing mock
  xLen: jest.fn(),       // Added missing mock
};

const mockRecord: Serializable = { foo: 'bar' } as any

describe('RedisStreamCollection', () => {
  let collection: RedisStreamCollection<typeof mockRecord>;

  beforeEach(() => {
    jest.clearAllMocks();
    collection = new RedisStreamCollection('job123', 'stream:test', 0, '0', mockRedis as any);
  });

  describe('init()', () => {
    // TODO: reviist and update the testcases. 
    // it('should create consumer groups if stream does not exist', async () => {
    //   mockRedis.exists.mockResolvedValue(false);
    //   mockRedis.xGroupCreate.mockResolvedValue('OK');
    //   await collection.init();
    //   expect(mockRedis.xGroupCreate).toHaveBeenCalledTimes(Object.values(GroupReaderType).length);
    // });

    // it('should not create consumer groups if stream exists', async () => {
    //   mockRedis.exists.mockResolvedValue(true);
    //   await collection.init();
    //   expect(mockRedis.xGroupCreate).not.toHaveBeenCalled();
    // });

    // it('should handle BUSYGROUP error gracefully', async () => {
    //   mockRedis.exists.mockResolvedValue(false);
    //   mockRedis.xGroupCreate.mockRejectedValueOnce(new Error('BUSYGROUP Consumer Group name already exists'));
    //   await collection.init();
    //   expect(mockRedis.xGroupCreate).toHaveBeenCalled();
    // });
  });

  describe('cleanup()', () => {
    it('should destroy the consumer group and delete keys', async () => {
      mockRedis.xGroupDestroy.mockResolvedValue(1);
      await collection.cleanup();
      expect(mockRedis.xGroupDestroy).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalledTimes(2);
    });

    it('should log warning if destroy fails', async () => {
      mockRedis.xGroupDestroy.mockRejectedValueOnce(new Error('fail'));
      await collection.cleanup();
      expect(mockRedis.del).toHaveBeenCalledTimes(2);
    });
  });

  describe('append()', () => {
    it('should encode and add a record to the stream', async () => {
      mockRedis.xAdd.mockResolvedValue('123-0');
      const id = await collection.append(mockRecord);
      expect(mockRedis.xAdd).toHaveBeenCalledWith('stream:test', '*', {
        obj: expect.any(String),
      });
      expect(id).toBe('123-0');
    });

    it('should throw error on append failure', async () => {
      mockRedis.xAdd.mockRejectedValueOnce(new Error('fail'));
      await expect(collection.append(mockRecord)).rejects.toThrow('fail');
    });
  });

  describe('read()', () => {
    it('should read and yield messages', async () => {
      mockRedis.get.mockResolvedValue(null);
      const encoded = encode(mockRecord).toString('base64');
      mockRedis.xRead.mockResolvedValue([
        {
          messages: [
            { id: '1-0', message: { obj: encoded } }
          ]
        }
      ]);
      const generator = collection.read('readerA');
      const result = await generator.next();
      expect(result.value).toEqual(mockRecord);
    });

  });

  describe('groupRead()', () => {
    it('should read and ACK messages, delete after full ACK', async () => {
      const encoded = encode(mockRecord).toString('base64');
      mockRedis.xReadGroup.mockResolvedValue([
        {
          messages: [
            { id: '1-0', message: { obj: encoded } }
          ]
        }
      ]);
      mockRedis.hIncrBy.mockResolvedValue(Object.values(GroupReaderType).length);
      const items = [];
      for await (const item of collection.groupRead('readerB', 1, GroupReaderType.DB_WRITER)) {
        items.push(item);
      }
      expect(items).toHaveLength(1);
      expect(mockRedis.xAck).toHaveBeenCalled();
      expect(mockRedis.xDel).toHaveBeenCalled();
      expect(mockRedis.hDel).toHaveBeenCalled();
    });

    it('should skip deletion if not enough ACKs', async () => {
      const encoded = encode(mockRecord).toString('base64');
      mockRedis.xReadGroup.mockResolvedValue([
        {
          messages: [
            { id: '1-0', message: { obj: encoded } }
          ]
        }
      ]);
      mockRedis.hIncrBy.mockResolvedValue(1);
      const items = [];
      for await (const item of collection.groupRead('readerB', 1, GroupReaderType.DB_WRITER)) {
        items.push(item);
      }
      expect(mockRedis.xDel).not.toHaveBeenCalled();
    });

    it('should return early if no messages', async () => {
      mockRedis.xReadGroup.mockResolvedValue(null);
      const results = [];
      for await (const val of collection.groupRead('readerC', 1, GroupReaderType.DB_WRITER)) {
        results.push(val);
      }
      expect(results).toHaveLength(0);
    });
  });

  describe('readAndPurge()', () => {
    it('should read, ACK and delete all messages', async () => {
      const encoded = encode(mockRecord).toString('base64');
      mockRedis.xReadGroup.mockResolvedValue([
        {
          messages: [
            { id: '1-0', message: { obj: encoded } }
          ]
        }
      ]);
      const results = [];
      for await (const val of collection.readAndPurge('readerD', 1, GroupReaderType.DB_WRITER)) {
        results.push(val);
      }
      expect(results).toHaveLength(1);
      expect(mockRedis.xAck).toHaveBeenCalled();
      expect(mockRedis.xDel).toHaveBeenCalled();
      expect(mockRedis.hDel).toHaveBeenCalled();
    });

    it('should exit early on no messages', async () => {
      mockRedis.xReadGroup.mockResolvedValue(null);
      const results = [];
      for await (const val of collection.readAndPurge('readerD', 1, GroupReaderType.DB_WRITER)) {
        results.push(val);
      }
      expect(results).toHaveLength(0);
    });
  });

  describe('close()', () => {
    it('should log on close', async () => {
      const logSpy = jest.spyOn(console, 'info').mockImplementation();
      await collection.close();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Closing collection'));
    });

    describe('groupReadWithoutAck()', () => {
      it('should yield messages from xReadGroup if present', async () => {
      const encoded = encode(mockRecord).toString('base64');
      mockRedis.xReadGroup.mockResolvedValue([
        {
        messages: [
          { id: '1-0', message: { obj: encoded } }
        ]
        }
      ]);
      const items: any[] = [];
      for await (const item of collection.groupReadWithoutAck('readerE', 1, GroupReaderType.DB_WRITER)) {
        items.push(item);
      }
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({ data: mockRecord, id: '1-0' });
      });

      it('should fallback to xAutoClaim if xReadGroup returns no messages', async () => {
      mockRedis.xReadGroup.mockResolvedValue(null);
      const encoded = encode(mockRecord).toString('base64');
      mockRedis.xAutoClaim = jest.fn().mockResolvedValue({
        messages: [
        { id: '2-0', message: { obj: encoded } }
        ]
      });
      const items: any[] = [];
      for await (const item of collection.groupReadWithoutAck('readerE', 1, GroupReaderType.DB_WRITER)) {
        items.push(item);
      }
      expect(mockRedis.xAutoClaim).toHaveBeenCalled();
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({ data: mockRecord, id: '2-0' });
      });

      it('should return early if neither xReadGroup nor xAutoClaim returns messages', async () => {
      mockRedis.xReadGroup.mockResolvedValue(null);
      mockRedis.xAutoClaim = jest.fn().mockResolvedValue({ messages: [] });
      const items: any[] = [];
      for await (const item of collection.groupReadWithoutAck('readerE', 1, GroupReaderType.DB_WRITER)) {
        items.push(item);
      }
      expect(items).toHaveLength(0);
      });
    });
  });
});
