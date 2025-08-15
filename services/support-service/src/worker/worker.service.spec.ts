import { Test, TestingModule } from '@nestjs/testing';
import { WorkerService } from './worker.service';

describe('WorkerService', () => {
  let service: WorkerService;
  let mockWorker: {
    close: jest.Mock;
  };

  beforeEach(async () => {
    // Create mock for TEMPORAL_WORKER
    mockWorker = {
      close: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerService,
        {
          provide: 'TEMPORAL_WORKER',
          useValue: mockWorker,
        },
      ],
    }).compile();

    service = module.get<WorkerService>(WorkerService);

    // Reset mock before each test
    mockWorker.close.mockClear();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should inject TEMPORAL_WORKER dependency', () => {
      expect(service).toBeInstanceOf(WorkerService);
    });
  });

  describe('close', () => {
    it('should call worker.close() method', async () => {
      // Mock successful close
      mockWorker.close.mockImplementation(() => Promise.resolve());

      await service.close();

      expect(mockWorker.close).toHaveBeenCalledTimes(1);
      expect(mockWorker.close).toHaveBeenCalledWith();
    });

    it('should handle worker.close() rejection', async () => {
      const error = new Error('Worker close failed');
      // Mock rejected close
      mockWorker.close.mockImplementation(() => Promise.reject(error));

      await expect(service.close()).rejects.toThrow('Worker close failed');
      expect(mockWorker.close).toHaveBeenCalledTimes(1);
    });

    it('should await worker.close() completion', async () => {
      let resolveClose: () => void;
      const closePromise = new Promise<void>((resolve) => {
        resolveClose = resolve;
      });

      mockWorker.close.mockImplementation(() => closePromise);

      const serviceClosePromise = service.close();

      // At this point, service.close() should be waiting
      expect(mockWorker.close).toHaveBeenCalledTimes(1);

      // Resolve the worker close
      resolveClose!();

      // Now service.close() should complete
      await serviceClosePromise;
    });
  });
});
