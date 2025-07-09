import { encode } from 'msgpack-lite';
import { RedisHMapCollection } from './redis-hmap-collection';
import { RedisClientType } from 'redis';

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

            expect(redisClient.hSet).toHaveBeenCalledWith(
                'jobRunId:mapType',
                key,
                encode(value).toString('base64'), // Ensure the value is encoded to base64
            );
        });
    });

    describe('getAll', () => {
        it('should retrieve all values from the Redis hash map', async () => {
            const val1 = '{"foo":"bar"}';
            const val2 = '{"baz":"qux"}'; 

            const encodedVal1 =  encode(val1).toString('base64');
            const encodedVal2 =  encode(val2).toString('base64');
            const mockData = { key1: encodedVal1, key2: encodedVal2 };

            redisClient.hGetAll.mockResolvedValue(mockData);

            const result = await collection.getAll();

            expect(redisClient.hGetAll).toHaveBeenCalledWith('jobRunId:mapType');
            expect(result["key1"]).toEqual(JSON.parse(val1));
            expect(result["key2"]).toEqual(JSON.parse(val2));
        });
    });

    describe('getValue', () => {
        it('should retrieve a specific value from the Redis hash map', async () => {
             const key = 'key1';
             const mockValue = '{"foo":"bar"}';
            redisClient.hGet.mockResolvedValue(encode(mockValue).toString('base64')); // Ensure the value is encoded to base64
            await collection.setValue(key, mockValue);

            const result = await collection.getValue(key);

            expect(redisClient.hGet).toHaveBeenCalledWith('jobRunId:mapType', key);
            expect(result).toEqual(JSON.parse(mockValue)); // Ensure the value is decoded correctly
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

    describe('getOneValue', () => {
        it('should retrieve the first key-value pair from the Redis hash map', async () => {

            const val1 = '{"foo":"bar"}';
            const val2 = '{"baz":"qux"}';
            const encodedValue1 = encode(val1).toString('base64');
            const encodedValue2 = encode(val2).toString('base64');

            const mockData = { key1: encodedValue1, key2: encodedValue2 };
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

    describe('assignToSelf', () => {
        it('should assign an existing value to a new key and delete the old key', async () => {
            const val1= '{"foo":"bar"}';
            const encodedValue1 = encode(val1).toString('base64');
            const mockData = { key1: encodedValue1 };
            redisClient.hGetAll.mockResolvedValue(mockData);

            const result = await collection.assignToSelf('newKey');

            expect(redisClient.hGetAll).toHaveBeenCalledWith('jobRunId:mapType');
            expect(redisClient.hSet).toHaveBeenCalledWith(
                'jobRunId:mapType',
                'newKey',
                encode(JSON.parse(val1)).toString("base64"), // Ensure the value is encoded to base64
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