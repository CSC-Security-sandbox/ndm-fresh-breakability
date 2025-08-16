import { RedisHMapCollection } from './redis-hmap-collection';
import { RedisClientType } from 'redis';
import * as zlib from 'zlib';
import { promisify } from "util";

const compress = promisify(zlib.gzip); 
const decompress = promisify(zlib.gunzip);

jest.mock('redis');



describe('RedisHMapCollection', () => {
    let redisClient: jest.Mocked<RedisClientType>;
    let collection: RedisHMapCollection<any>;

    beforeEach(() => {
        redisClient = {
            del: jest.fn(),
            hSet: jest.fn(),
            hGetAll: jest.fn(),
            hGet: jest.fn(),
            hDel: jest.fn(),
        } as any;

        collection = new RedisHMapCollection('jobRunId', 'mapType', redisClient);
    });    

    describe('cleanup', () => {
        it('should delete the Redis map key', async () => {
            await collection.cleanup();
            expect(redisClient.del).toHaveBeenCalledWith('jobRunId:mapType');
        });
    });

    describe('setValue', () => {
        it('should set a value in the Redis hash map', async () => {
            const key = 'key1';
            const value = { foo: 'bar' };

            await collection.setValue(key, value);
            const compressedValue = await compress(JSON.stringify(value));
            expect(redisClient.hSet).toHaveBeenCalledWith(
                'jobRunId:mapType',
                key,
                compressedValue.toString('base64')
            );
        });
    });

    describe('getAll', () => {
        it('should retrieve all values from the Redis hash map', async () => {
            const val1 = '{ "foo": "bar" }';
            const val2 = '{ "baz": "qux" }';
            const compressedVal1 = (await compress(val1)).toString('base64');
            const compressedVal2 = (await compress(val2)).toString('base64');
            const mockData = { key1: compressedVal1, key2: compressedVal2 };
            redisClient.hGetAll.mockResolvedValue(mockData);

            const result = await collection.getAll();

            expect(redisClient.hGetAll).toHaveBeenCalledWith('jobRunId:mapType');
            expect(result['key1']).toEqual(JSON.parse(val1));
            expect(result['key2']).toEqual(JSON.parse(val2));
        }); 
    });

    describe('getValue', () => {
        it('should retrieve a specific value from the Redis hash map', async () => {
            const key = 'key1';
            const mockValue = JSON.stringify({"foo":"bar"}) ;
            const compresesedValue = (await compress(mockValue)).toString('base64');
            redisClient.hGet.mockResolvedValue(compresesedValue);

            const result = await collection.getValue(key);

            expect(redisClient.hGet).toHaveBeenCalledWith('jobRunId:mapType', key);
            expect(result).toEqual({ foo: 'bar' });
        });

        it('should return null if the key does not exist', async () => {
            const key = 'key1';
            redisClient.hGet.mockResolvedValue(null);

            const result = await collection.getValue(key);

            expect(redisClient.hGet).toHaveBeenCalledWith('jobRunId:mapType', key);
            expect(result).toBeNull();
        });
    });

    describe('deleteValue', () => {
        it('should delete a specific value from the Redis hash map', async () => {
            const key = 'key1';

            await collection.deleteValue(key);

            expect(redisClient.hDel).toHaveBeenCalledWith('jobRunId:mapType', key);
        });
    });

    describe('deleteAll', () => {
        it('should delete the entire Redis hash map', async () => {
            await collection.deleteAll();

            expect(redisClient.del).toHaveBeenCalledWith('jobRunId:mapType');
        });
    });

    xdescribe('getOneValue', () => {
        it('should retrieve the first key-value pair from the Redis hash map', async () => {
            const mockData = { key1: '{"foo":"bar"}', key2: '{"baz":"qux"}' };
            redisClient.hGetAll.mockResolvedValue(mockData);

            const result = await collection.getOneValue();

            expect(redisClient.hGetAll).toHaveBeenCalledWith('jobRunId:mapType');
            expect(result).toEqual({ key: 'key1', value: { foo: 'bar' } });
        });

        it('should return null if the hash map is empty', async () => {
            redisClient.hGetAll.mockResolvedValue({});

            const result = await collection.getOneValue();

            expect(redisClient.hGetAll).toHaveBeenCalledWith('jobRunId:mapType');
            expect(result).toBeNull();
        });
    });

    xdescribe('assignToSelf', () => {
        it('should assign an existing value to a new key and delete the old key', async () => {
            const mockData = { key1: '{"foo":"bar"}' };
            redisClient.hGetAll.mockResolvedValue(mockData);

            const result = await collection.assignToSelf('newKey');

            expect(redisClient.hGetAll).toHaveBeenCalledWith('jobRunId:mapType');
            expect(redisClient.hSet).toHaveBeenCalledWith(
                'jobRunId:mapType',
                'newKey',
                '{"foo":"bar"}',
            );
            expect(redisClient.hDel).toHaveBeenCalledWith('jobRunId:mapType', 'key1');
            expect(result).toEqual({ foo: 'bar' });
        });

        it('should return null if no existing value is found', async () => {
            redisClient.hGetAll.mockResolvedValue({});

            const result = await collection.assignToSelf('newKey');

            expect(redisClient.hGetAll).toHaveBeenCalledWith('jobRunId:mapType');
            expect(result).toBeNull();
        });

        describe('isEmpty', () => {
            it('should return true if the hash map is empty', async () => {
            redisClient.hLen = jest.fn().mockResolvedValue(0);
            const result = await collection.isEmpty();
            expect(redisClient.hLen).toHaveBeenCalledWith('jobRunId:mapType');
            expect(result).toBe(true);
            });

            it('should return false if the hash map is not empty', async () => {
            redisClient.hLen = jest.fn().mockResolvedValue(2);
            const result = await collection.isEmpty();
            expect(redisClient.hLen).toHaveBeenCalledWith('jobRunId:mapType');
            expect(result).toBe(false);
            });
        });

        describe('getSize', () => {
            it('should return the number of items in the hash map', async () => {
            const mockData = { key1: '{"foo":"bar"}', key2: '{"baz":"qux"}' };
            redisClient.hGetAll.mockResolvedValue(mockData);
            const result = await collection.getSize();
            expect(redisClient.hGetAll).toHaveBeenCalledWith('jobRunId:mapType');
            expect(result).toBe(2);
            });

            it('should return 0 if the hash map is empty', async () => {
            redisClient.hGetAll.mockResolvedValue({});
            const result = await collection.getSize();
            expect(redisClient.hGetAll).toHaveBeenCalledWith('jobRunId:mapType');
            expect(result).toBe(0);
            });

            it('should return 0 if hGetAll returns null', async () => {
            redisClient.hGetAll.mockResolvedValue(null);
            const result = await collection.getSize();
            expect(redisClient.hGetAll).toHaveBeenCalledWith('jobRunId:mapType');
            expect(result).toBe(0);
            });
        });

        describe('init and close', () => {
            it('should resolve without error', async () => {
            await expect(collection.init()).resolves.toBeUndefined();
            await expect(collection.close()).resolves.toBeUndefined();
            });
        });


    });
});