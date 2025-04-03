import { Test, TestingModule } from '@nestjs/testing';
import { WorkerThreadService } from './worker.thread.service';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Worker } from 'worker_threads';
import { ThreadOperation } from './worker.thread.type';

jest.mock('worker_threads', () => {
    const EventEmitter = require('events');
    class MockWorker extends EventEmitter {
        postMessage(message) {
            if (message.Operation === ThreadOperation.EXIT) {
                this.emit('exit', 0);
            } else {
                this.emit('message', { id: message.id, isResolved: true, data: 'success' });
            }
        }
    }
    return { Worker: MockWorker };
});

describe('WorkerThreadService', () => {
    let service: WorkerThreadService;
    let configService: ConfigService;
    let logger: Logger;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                WorkerThreadService,
                { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(2) } },
                { provide: Logger, useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } }
            ],
        }).compile();

        service = module.get<WorkerThreadService>(WorkerThreadService);
        configService = module.get<ConfigService>(ConfigService);
        logger = module.get<Logger>(Logger);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('should initialize workers correctly', () => {
        expect(service["workers"].length).toBe(2);
        expect(service["availableWorkers"].length).toBe(2);
    });
});
