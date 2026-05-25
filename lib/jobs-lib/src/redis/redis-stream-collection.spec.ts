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
  multi: jest.fn(),      // Added missing mock
};

const mockRecord: Serializable = { foo: 'bar' } as any

describe('RedisStreamCollection', () => {
  let collection: RedisStreamCollection<typeof mockRecord>;

  beforeEach(() => {
    jest.clearAllMocks();
    collection = new RedisStreamCollection('job123', 'stream:test', 0, '0', mockRedis as any);
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

    it('should throw error on append failure for non-ECONNRESET errors', async () => {
      mockRedis.xAdd.mockRejectedValueOnce(new Error('fail'));
      await expect(collection.append(mockRecord)).rejects.toThrow('fail');
      expect(mockRedis.xAdd).toHaveBeenCalledTimes(1);
    });

    it('should retry on ECONNRESET error and succeed on second attempt', async () => {
      const connectionResetError = new Error('Connection reset by peer');
      connectionResetError.message = 'read ECONNRESET';
      
      mockRedis.xAdd
        .mockRejectedValueOnce(connectionResetError)
        .mockResolvedValueOnce('123-0');

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const id = await collection.append(mockRecord);
      
      expect(mockRedis.xAdd).toHaveBeenCalledTimes(2);
      expect(id).toBe('123-0');
      expect(consoleSpy).toHaveBeenCalledWith('Connection reset error occurred, retrying... (attempt 1)');
      
      consoleSpy.mockRestore();
    });

    it('should retry on ECONNRESET error code and succeed on third attempt', async () => {
      const connectionResetError = new Error('Network error');
      (connectionResetError as any).code = 'ECONNRESET';
      
      mockRedis.xAdd
        .mockRejectedValueOnce(connectionResetError)
        .mockRejectedValueOnce(connectionResetError)
        .mockResolvedValueOnce('456-1');

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const id = await collection.append(mockRecord);
      
      expect(mockRedis.xAdd).toHaveBeenCalledTimes(3);
      expect(id).toBe('456-1');
      expect(consoleSpy).toHaveBeenCalledWith('Connection reset error occurred, retrying... (attempt 1)');
      expect(consoleSpy).toHaveBeenCalledWith('Connection reset error occurred, retrying... (attempt 2)');
      
      consoleSpy.mockRestore();
    });

    it('should fail after 3 ECONNRESET retry attempts', async () => {
      const connectionResetError = new Error('read ECONNRESET');
      
      mockRedis.xAdd
        .mockRejectedValue(connectionResetError);

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      await expect(collection.append(mockRecord)).rejects.toThrow('read ECONNRESET');
      
      expect(mockRedis.xAdd).toHaveBeenCalledTimes(3);
      expect(consoleSpy).toHaveBeenCalledTimes(3); // All 3 attempts log retry warnings
      expect(errorSpy).toHaveBeenCalledWith(`Error writing record: ${connectionResetError}`, connectionResetError);
      
      consoleSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should not retry for non-ECONNRESET errors', async () => {
      const otherError = new Error('Some other Redis error');
      mockRedis.xAdd.mockRejectedValueOnce(otherError);

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      await expect(collection.append(mockRecord)).rejects.toThrow('Some other Redis error');
      
      expect(mockRedis.xAdd).toHaveBeenCalledTimes(1);
      expect(consoleSpy).not.toHaveBeenCalled(); // No retry warnings
      expect(errorSpy).toHaveBeenCalledWith(`Error writing record: ${otherError}`, otherError);
      
      consoleSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should update numMessages and lastId on successful append', async () => {
      mockRedis.xAdd.mockResolvedValue('789-2');
      const initialNumMessages = collection.numMessages;
      
      const id = await collection.append(mockRecord);
      
      expect(collection.numMessages).toBe(initialNumMessages + 1);
      expect(collection.lastId).toBe('789-2');
      expect(id).toBe('789-2');
    });

    it('should wait between retry attempts', async () => {
      jest.useFakeTimers();
      
      const connectionResetError = new Error('read ECONNRESET');
      mockRedis.xAdd
        .mockRejectedValueOnce(connectionResetError)
        .mockResolvedValueOnce('retry-test');

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const appendPromise = collection.append(mockRecord);
      
      // Fast forward through the delay
      jest.advanceTimersByTime(500); // First retry delay is 500ms (attempt * 500)
      
      await appendPromise;
      
      expect(mockRedis.xAdd).toHaveBeenCalledTimes(2);
      expect(consoleSpy).toHaveBeenCalledWith('Connection reset error occurred, retrying... (attempt 1)');
      
      consoleSpy.mockRestore();
      jest.useRealTimers();
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

  describe('drainPendingEntries()', () => {
    it('should stop immediately and yield nothing when PEL is empty', async () => {
      mockRedis.xReadGroup.mockResolvedValue(null);

      const items: { data: typeof mockRecord; id: string }[] = [];
      for await (const item of collection.drainPendingEntries('readerF', 10, GroupReaderType.DB_WRITER)) {
        items.push(item);
      }

      expect(items).toHaveLength(0);
      expect(mockRedis.xReadGroup).toHaveBeenCalledTimes(1);
      expect(mockRedis.xReadGroup).toHaveBeenCalledWith(
        `job123-${GroupReaderType.DB_WRITER}`,
        'readerF',
        [{ key: 'stream:test', id: '0-0' }],
        { COUNT: 10 },
      );
      // must not ACK or delete — that is the caller's responsibility
      expect(mockRedis.xAck).not.toHaveBeenCalled();
      expect(mockRedis.xDel).not.toHaveBeenCalled();
    });

    it('should stop when xReadGroup returns an empty messages array', async () => {
      mockRedis.xReadGroup.mockResolvedValue([{ messages: [] }]);

      const items: { data: typeof mockRecord; id: string }[] = [];
      for await (const item of collection.drainPendingEntries('readerF', 10, GroupReaderType.DB_WRITER)) {
        items.push(item);
      }

      expect(items).toHaveLength(0);
      expect(mockRedis.xReadGroup).toHaveBeenCalledTimes(1);
    });

    it('should yield decoded { data, id } for each message in a single page', async () => {
      const encoded = encode(mockRecord).toString('base64');
      mockRedis.xReadGroup
        .mockResolvedValueOnce([
          { messages: [{ id: '1-0', message: { obj: encoded } }] },
        ])
        .mockResolvedValueOnce(null); // second call: PEL drained

      const items: { data: typeof mockRecord; id: string }[] = [];
      for await (const item of collection.drainPendingEntries('readerF', 10, GroupReaderType.DB_WRITER)) {
        items.push(item);
      }

      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({ data: mockRecord, id: '1-0' });
    });

    it('should advance the cursor across pages and yield all messages', async () => {
      const encoded = encode(mockRecord).toString('base64');
      mockRedis.xReadGroup
        .mockResolvedValueOnce([
          {
            messages: [
              { id: '1-0', message: { obj: encoded } },
              { id: '2-0', message: { obj: encoded } },
            ],
          },
        ])
        .mockResolvedValueOnce([
          {
            messages: [
              { id: '3-0', message: { obj: encoded } },
            ],
          },
        ])
        .mockResolvedValueOnce(null); // PEL exhausted

      const items: { data: typeof mockRecord; id: string }[] = [];
      for await (const item of collection.drainPendingEntries('readerF', 2, GroupReaderType.DB_WRITER)) {
        items.push(item);
      }

      expect(items).toHaveLength(3);
      expect(items.map(i => i.id)).toEqual(['1-0', '2-0', '3-0']);

      // First call must use the initial cursor
      expect(mockRedis.xReadGroup).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        'readerF',
        [{ key: 'stream:test', id: '0-0' }],
        { COUNT: 2 },
      );
      // Second call must use the last ID from the first page as the cursor
      expect(mockRedis.xReadGroup).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        'readerF',
        [{ key: 'stream:test', id: '2-0' }],
        { COUNT: 2 },
      );
      // Third call must use the last ID from the second page
      expect(mockRedis.xReadGroup).toHaveBeenNthCalledWith(
        3,
        expect.any(String),
        'readerF',
        [{ key: 'stream:test', id: '3-0' }],
        { COUNT: 2 },
      );
    });

    it('should use the correct consumer group name', async () => {
      mockRedis.xReadGroup.mockResolvedValue(null);

      for await (const _ of collection.drainPendingEntries('readerF', 5, GroupReaderType.DB_WRITER)) { /* drain */ }

      expect(mockRedis.xReadGroup).toHaveBeenCalledWith(
        `job123-${GroupReaderType.DB_WRITER}`,
        expect.any(String),
        expect.any(Array),
        expect.any(Object),
      );
    });

    it('should never call xAck or xDel — ACKing is the caller\'s responsibility', async () => {
      const encoded = encode(mockRecord).toString('base64');
      mockRedis.xReadGroup
        .mockResolvedValueOnce([
          { messages: [{ id: '1-0', message: { obj: encoded } }] },
        ])
        .mockResolvedValueOnce(null);

      for await (const _ of collection.drainPendingEntries('readerF', 10, GroupReaderType.DB_WRITER)) { /* drain */ }

      expect(mockRedis.xAck).not.toHaveBeenCalled();
      expect(mockRedis.xDel).not.toHaveBeenCalled();
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

      describe('ackAndPurge()', () => {
        it('should ACK and delete all provided ids and return true if all succeed', async () => {
          const multiExecMock = jest.fn().mockResolvedValue([1, 1, 1, 1]);
          const multiMock = {
            xAck: jest.fn().mockReturnThis(),
            xDel: jest.fn().mockReturnThis(),
            exec: multiExecMock,
          };
          mockRedis.multi = jest.fn(() => multiMock);
          const ids = ['1-0', '2-0'];
          const result = await collection.ackAndPurge(ids, GroupReaderType.DB_WRITER);
          expect(mockRedis.multi).toHaveBeenCalled();
          expect(multiMock.xAck).toHaveBeenCalledTimes(ids.length);
          expect(multiMock.xDel).toHaveBeenCalledTimes(ids.length);
          expect(multiExecMock).toHaveBeenCalled();
          expect(result).toBe(true);
        });

        it('should return false if multi.exec throws', async () => {
          const multiMock = {
            xAck: jest.fn().mockReturnThis(),
            xDel: jest.fn().mockReturnThis(),
            exec: jest.fn().mockRejectedValue(new Error('fail')),
          };
          mockRedis.multi = jest.fn(() => multiMock);
          const result = await collection.ackAndPurge(['1-0'], GroupReaderType.DB_WRITER);
          expect(result).toBe(false);
        });

        it('should return false if exec returns non-array', async () => {
          const multiMock = {
            xAck: jest.fn().mockReturnThis(),
            xDel: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue(null),
          };
          mockRedis.multi = jest.fn(() => multiMock);
          const result = await collection.ackAndPurge(['1-0'], GroupReaderType.DB_WRITER);
          expect(result).toBe(false);
        });

        it('should return false if any command result is null', async () => {
          const multiMock = {
            xAck: jest.fn().mockReturnThis(),
            xDel: jest.fn().mockReturnThis(),
            exec: jest.fn().mockResolvedValue([1, null]),
          };
          mockRedis.multi = jest.fn(() => multiMock);
          const result = await collection.ackAndPurge(['1-0', '2-0'], GroupReaderType.DB_WRITER);
          expect(result).toBe(false);
        });
      });

      describe('getLength()', () => {
        it('should return the stream length', async () => {
          mockRedis.xLen.mockResolvedValue(42);
          const len = await collection.getLength();
          expect(mockRedis.xLen).toHaveBeenCalledWith('stream:test');
          expect(len).toBe(42);
        });
      });
    });
  });
});
