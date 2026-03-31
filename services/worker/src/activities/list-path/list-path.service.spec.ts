 import { Test, TestingModule } from '@nestjs/testing';
 import { ConfigService } from '@nestjs/config';
 import { ListPathActivity } from './list-path.service';
 import { Protocols } from 'src/protocols/protocols';
 import { LoggerFactory, LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
 import { mockLogger } from 'src/auth/auth.service.spec';

 jest.mock('src/protocols/protocols');
 
 describe('ListPathActivity', () => {
   let service: ListPathActivity;
   let configService: ConfigService;
  let loggerFactory: LoggerFactory;
  let logger: LoggerService;
  let protocols: Protocols;
 
   beforeEach(async () => {
    const mockProtocols = {
      getProtocol: jest.fn(),
    };

    const mockLoggerFactory = {
      create: jest.fn().mockReturnValue(mockLogger),
    };

     const module: TestingModule = await Test.createTestingModule({
       providers: [
         ListPathActivity,
         {
           provide: ConfigService,
           useValue: {
             get: jest.fn((key) => {
               if (key === 'worker.workerId') return 'test-worker-id';
               return null;
             }),
           },
         },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
        {
          provide: LoggerService,
          useValue: mockLogger as any,
        },
        {
          provide: Protocols,
          useValue: mockProtocols,
        },
       ],
     }).compile();
 
     service = module.get<ListPathActivity>(ListPathActivity);
     configService = module.get<ConfigService>(ConfigService);
      loggerFactory = module.get<LoggerFactory>(LoggerFactory);
      logger = module.get<LoggerService>(LoggerService);
      protocols = module.get<Protocols>(Protocols);
   });
 
   it('should be defined', () => {
     expect(service).toBeDefined();
   });
 
   it('should initialize workerId from ConfigService', () => {
     expect(service.workerId).toBe('test-worker-id');
   });
 
   describe('listPath', () => {
     const traceId = 'test-trace-id';
     const protocolType = 'FTP';
     const payload = { hostname: 'test-host' };
 
     it('should return success response when protocol resolves paths', async () => {
       const mockProtocol = {
         listPaths: jest.fn().mockResolvedValue(['path1', 'path2']),
       };
       (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);
 
       const result = await service.listPath(traceId, protocolType, payload);
 
       expect(result).toEqual({
         traceId,
         status: 'success',
         protocolType,
         hostname: payload.hostname,
         workerId: 'test-worker-id',
         paths: ['path1', 'path2'],
         message: `[${protocolType}] Connection to ${payload.hostname} from test-worker-id validated successfully`,
       });
       expect(mockProtocol.listPaths).toHaveBeenCalledWith(traceId, payload);
       expect(logger.log).toHaveBeenCalledWith(
         `[${traceId}] List Path for ${payload.hostname} of type ${protocolType} from test-worker-id`,
       );
     });
 
     it('should return error response when protocol throws an error', async () => {
       const mockProtocol = {
         listPaths: jest.fn().mockRejectedValue(new Error('Protocol error')),
       };
       (protocols.getProtocol as jest.Mock).mockReturnValue(mockProtocol);

       const result = await service.listPath(traceId, protocolType, payload);

       expect(result).toEqual({
         traceId,
         status: 'error',
         protocolType,
         hostname: payload.hostname,
         workerId: 'test-worker-id',
         paths: [],
         message: `Failed to List Path for ${payload.hostname} of type ${protocolType}: Error: Protocol error`,
       });
       expect(mockProtocol.listPaths).toHaveBeenCalledWith(traceId, payload);
       expect(logger.log).toHaveBeenCalledWith(
         `[${traceId}] List Path for ${payload.hostname} of type ${protocolType} from test-worker-id`,
       );
     });
   });
 });