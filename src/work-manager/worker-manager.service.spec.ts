import { Test, TestingModule } from '@nestjs/testing';
import { WorkManagerService } from './work-manager.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'src/logger/logger.service';
import { of, retry, throwError, timer } from 'rxjs';
import { WorkerConfiguration, WorkerState } from './work-manager.types';
import { NativeConnection, Worker } from '@temporalio/worker';
import { CronExpression } from '@nestjs/schedule';
import { WorkerOptionsFactory } from './factory/worker-options.factory';


jest.mock('@nestjs/axios');
jest.mock('@nestjs/config');
jest.mock('src/logger/logger.service');
jest.mock('./factory/worker-options.factory');
jest.mock('src/utils/worker-manager.mappers');

jest.mock('@temporalio/worker', () => ({
    Worker: {
      create: jest.fn(),
    },
    WorkerState: {
      INITIALIZED: 'initialized',
      RUNNING: 'running',
      STOPPED: 'stopped',
    },
    NativeConnection : {
        connect: jest.fn()
    }
  }));
  
  jest.mock('./factory/worker-options.factory', () => ({
    WorkerOptionsFactory: jest.fn(),
  }));


const mockNativeConnection = {
connect: jest.fn(),
};

describe('WorkManagerService', () => {
    let service: WorkManagerService;
    let httpService: HttpService;
    let configService: ConfigService;
    let logger: Logger;
    let workerOptionsFactory: typeof WorkerOptionsFactory;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                WorkManagerService,
                {
                    provide: HttpService,
                    useValue: {
                        get: jest.fn(),
                        post: jest.fn(),
                        subscribe: jest.fn().mockImplementation((nextFn: any)=> nextFn.next())
                    },
                },
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn().mockImplementation(
                            (s: string)=> s == 'worker.workerStartupTimeout' ? 3000:
                        'test-value'),
                    },
                },
                {
                    provide: Logger,
                    useValue: {
                        info: jest.fn(),
                        error: jest.fn(),
                        warn: jest.fn(),
                        debug: jest.fn(),
                    },
                },
            ],
        }).compile();

        service = module.get<WorkManagerService>(WorkManagerService);
        httpService = module.get<HttpService>(HttpService);
        configService = module.get<ConfigService>(ConfigService);
        logger = module.get<Logger>(Logger);
        workerOptionsFactory = WorkerOptionsFactory;
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('getAccessToken', () => {
      it('should fetch a new access token', async () => {
        jest.spyOn(httpService, 'post').mockReturnValue({ data: { access_token: 'test-token', expires_in: 300 } } as any);
        const token = await service['getAccessToken']();
        expect(token).toBeDefined();
      });
  
      it('should return null if token fetch fails', async () => {
        jest.spyOn(httpService, 'post').mockReturnValue(throwError(() => new Error('Keycloak error')));
        const token = await service['getAccessToken']();
        expect(token).toBeNull();
      });
    });
  
    describe('handleCron', () => {
      it('should fetch configurations and call handleConfigurations', async () => {
        jest.spyOn(service, 'getAccessToken').mockResolvedValue('valid-token');
        jest.spyOn(httpService, 'get').mockReturnValue(of({ status: 200, data: [] } as any));
        jest.spyOn(service, 'handleConfigurations').mockResolvedValue(undefined);
  
        await service.handleCron();
        expect(service['handleConfigurations']).toHaveBeenCalledWith([]);
      });
    });

    describe('startWorker', () => {
     
  
      it('should wait until worker state is RUNNING', async () => {
        const id = 'worker1';
        const workerOptions = { options: 'workerOptions' };
        const worker: Worker = {
          getState: jest.fn()
            .mockReturnValueOnce(WorkerState.INITIALIZED) 
            .mockReturnValueOnce(WorkerState.RUNNING),
          run: jest.fn(),
          options: { identity: id },
          shutdown: jest.fn(),
        } as any;
      
        Worker.create = jest.fn().mockResolvedValue(worker);
      
        await service.startWorker(id, workerOptions);

        expect(worker.getState).toHaveBeenCalledTimes(2); 
        expect(worker.run).toHaveBeenCalled();
      }, 3000);

    
    
    });

    describe('shutdownWorker', ()=>{
        jest.useFakeTimers(); 

        it('should shutdown the worker gracefully', async () => {
            const id = 'worker1';
            const worker: Worker = {
                getState: jest.fn()
                .mockReturnValueOnce( WorkerState.RUNNING) 
                .mockReturnValueOnce( WorkerState.STOPPED),
                shutdown: jest.fn(),
                options: { identity: id },
            } as any;

            Worker.create = jest.fn().mockResolvedValue(worker);

            await service.shutdownWorker(worker, false);
            jest.advanceTimersByTime(10000);
            expect(worker.shutdown).toHaveBeenCalled();
            expect(worker.getState).toHaveBeenCalledTimes(2); 
        });

        it('should shutdown the worker immediately when forced', async () => {
            const id = 'worker2';
            const worker: Worker = {
                getState: jest.fn().mockReturnValue( WorkerState.RUNNING),
                shutdown: jest.fn(),
                options: { identity: id },
            } as any;
            Worker.create = jest.fn().mockResolvedValue(worker);

            await service.shutdownWorker(worker, true);
            jest.advanceTimersByTime(10000);
            expect(worker.shutdown).toHaveBeenCalled();
        });

        it('should shutdown the worker immediately when forced 1', async () => {
            const id = 'worker2';
            const worker: Worker = {
                getState: jest.fn()
                .mockReturnValueOnce( WorkerState.RUNNING)
                .mockReturnValueOnce( WorkerState.RUNNING),
                shutdown: jest.fn(),
                options: { identity: id },
            } as any;
            Worker.create = jest.fn().mockResolvedValue(worker);

            await service.shutdownWorker(worker, true);
            jest.advanceTimersByTime(1000);
            expect(worker.shutdown).toHaveBeenCalled();
        });

        it('should shutdown the worker immediately when forced 1', async () => {
          const id = 'worker2';
          const worker: Worker = {
              getState: jest.fn()
              .mockReturnValueOnce( WorkerState.RUNNING)
              .mockReturnValueOnce( WorkerState.STOPPED),
              shutdown: jest.fn(),
              options: { identity: id },
          } as any;
          Worker.create = jest.fn().mockResolvedValue(worker);

          await service.shutdownWorker(worker, false);
          expect(worker.shutdown).toHaveBeenCalled();
      });
    })

    describe('onApplicationBootstrap', () => {
        it('should establish a connection to Temporal', async () => {
          await service.onApplicationBootstrap();
          expect(logger.info).toHaveBeenCalledWith('[onApplicationBootstrap] - Starting Worker Service');
        })
    });

    describe('handleConfigurations', () => {
        let mockConfigs: WorkerConfiguration[];
    
        beforeEach(() => {
          mockConfigs = [
            {
              workerId: 'worker-1',
              configName: 'PARENT_WORKFLOW',
              taskQueueId: 'taskQueue1',
              dynamicTaskQueue: true,
            },
            {
              workerId: 'worker-2',
              configName: 'WORKER_SPECIFIC_WORKFLOW',
              taskQueueId: 'taskQueue2',
              dynamicTaskQueue: false,
            },
          ];
        });
    
        it('should handle worker startup  gracefully', async () => {
          jest.spyOn(service, 'startWorker').mockImplementation(() => {
            return new Promise((resolve, reject) => resolve());
          });
          await expect(service.handleConfigurations(mockConfigs))
          expect(service.startWorker).toHaveBeenCalled()
        });


        it('should handle worker startup  gracefully 1', async () => {
          jest.spyOn(service, 'startWorker').mockImplementation(() => {
            return new Promise((resolve, reject) => resolve());
          });
          await expect(service.handleConfigurations([]))
        });

      });
});
