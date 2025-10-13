import { WorkerService } from './worker.service';

describe('WorkerService', () => {
  let workerMock: { close: jest.Mock };
  let service: WorkerService;

  beforeEach(() => {
    workerMock = { close: jest.fn() };
    service = new WorkerService(workerMock as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('close', () => {
    it('should call worker.close', async () => {
      await service.close();
      expect(workerMock.close).toHaveBeenCalled();
    });

    it('should propagate errors from worker.close', async () => {
      workerMock.close.mockRejectedValue(new Error('close error'));
      await expect(service.close()).rejects.toThrow('close error');
    });
  });
});