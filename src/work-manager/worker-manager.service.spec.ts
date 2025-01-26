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

    describe('handleCron', () => {
        it('should fetch configurations and handle them', async () => {
            const response = { status: 200, data: [] };
            const getSpy = jest.spyOn(httpService, 'get').mockReturnValue(of(response) as any);
            const handleConfigsSpy = jest.spyOn(service, 'handleConfigurations');
            
            const subscription = service.handleCron();
            await subscription;
            expect(getSpy).toHaveBeenCalled();
            expect(handleConfigsSpy).toHaveBeenCalledWith(response.data);
        });

        it('should not fetch configurations if already loading', async () => {
            service['loadingConfigs'] = true;
            const getSpy = jest.spyOn(httpService, 'get');
            const subscription = service.handleCron();
            await subscription;

            expect(getSpy).not.toHaveBeenCalled();
        });

        it('should fetch configurations and handle them', async () => {
            const response = { status: 200, data: [] };
            const getSpy = jest.spyOn(httpService, 'get').mockReturnValue(of(response) as any);
            const handleConfigsSpy = jest.spyOn(service, 'handleConfigurations');
            const subscription = service.handleCron();
            await subscription;
            expect(getSpy).toHaveBeenCalled();
            expect(handleConfigsSpy).toHaveBeenCalledWith(response.data);
        });

        it('should retry fetching configurations and handle response', async () => {
            const mockResponse = { status: 200, data: { key: 'value' } };
        
            jest.spyOn(httpService, 'get').mockReturnValue(
              of(mockResponse).pipe(
                retry({
                  count: 3,
                  delay: (error, retryCount) => {
                    logger.warn(`Retrying to fetch configurations. Attempt: ${retryCount}`);
                    return timer(2000); 
                  },
                }),
              ) as any,
            );
        

            const handleConfigurationsMock = jest.spyOn(service, 'handleConfigurations').mockResolvedValue(undefined);
        
            await service.handleCron();
        
            expect(httpService.get).toHaveBeenCalledTimes(1);
            expect(handleConfigurationsMock).toHaveBeenCalledWith(mockResponse.data); 
        });


        it('should log error if fetch configurations fails after retries 3', async () => {
            const mockError = new Error('Network Error');

            jest.spyOn(httpService, 'get').mockReturnValue(
            throwError(() => mockError).pipe(
                retry({
                count: 3,
                delay: (error, retryCount) => {
                    logger.warn(`Retrying to fetch configurations. Attempt: ${retryCount}`);
                    return timer(2000); 
                },
                }),
            ),
            );


            await service.handleCron();

            await httpService.get('').pipe(
                retry({
                    count: 3,
                    delay: (error, retryCount) => {
                    logger.warn(`Retrying to fetch configurations. Attempt: ${retryCount}`);
                    return timer(2000);
                    },
                })
                ).subscribe({
                next: async (response) => {
                    if (response.status !== 200) {
                    logger.error(`Failed to fetch configurations. Status code: ${response.status}`);
                    return;
                    }
                    await service.handleConfigurations(response.data);
                },
                error: (error) => {
                    logger.error(`Failed to fetch configurations: ${error}`);
                },
            });

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

        it('should shutdown the worker immediately when forced', async () => {
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
    })

    describe('onApplicationBootstrap', () => {
        it('should establish a connection to Temporal', async () => {
          await service.onApplicationBootstrap();
          expect(logger.info).toHaveBeenCalledWith('[onApplicationBootstrap] - Starting Worker Service');
        });
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

      });
    

});
