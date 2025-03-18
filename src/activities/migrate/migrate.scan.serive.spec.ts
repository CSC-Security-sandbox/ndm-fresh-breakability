import { Test, TestingModule } from '@nestjs/testing';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { RedisService } from 'src/redis/redis.service';
import { MigrationScanService } from './migrate.scan.service';

jest.mock('fs', () => ({
    existsSync: jest.fn(),
    promises: {
        readdir: jest.fn(),
        lstat: jest.fn(),
    },
    statSync: jest.fn(),
    mkdirSync: jest.fn(),
    createWriteStream: jest.fn(), 
}));


describe('MigrationScanService', () => {
    let service: MigrationScanService;
    let configService: ConfigService;
    let logger: Logger;
    let redisService: RedisService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MigrationScanService,
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn().mockImplementation((key) => {
                            if (key === 'worker.workerId') return 'test-worker-id';
                            if (key === 'worker.maxRetryCount') return 3;
                            return null;
                        })
                    }
                },
                {
                    provide: Logger,
                    useValue: {
                        debug: jest.fn(),
                        log: jest.fn()
                    }
                },
                {
                    provide: RedisService,
                    useValue: {
                        getJobContext: jest.fn(),
                        setJobContext: jest.fn()
                    }
                }
            ]
        }).compile();

        service = module.get<MigrationScanService>(MigrationScanService);
        configService = module.get<ConfigService>(ConfigService);
        logger = module.get<Logger>(Logger);
        redisService = module.get<RedisService>(RedisService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('getDirectoryContents', () => {
        it('should return an empty array if directory does not exist', async () => {
            (fs.existsSync as jest.Mock).mockReturnValue(false);
            const result = await service.getDirectoryContents('/fake/path');
            expect(result).toEqual([]);
        });

        it('should return directory contents if directory exists', async () => {
            (fs.existsSync as jest.Mock).mockReturnValue(true);
            (fs.promises.readdir as jest.Mock).mockResolvedValue(['file1.txt', 'file2.txt']);
            const result = await service.getDirectoryContents('/fake/path');
            expect(result).toEqual(['file1.txt', 'file2.txt']);
        });
    });
});
