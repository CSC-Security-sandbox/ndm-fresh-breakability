import { Test, TestingModule } from '@nestjs/testing';
import { WorkerRegistrationController } from './worker-registration.controller';
import { WorkerRegistrationService } from './worker-registration.service';
import { RegisterWorkerDto } from './dto/register-worker.dto';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';
import { BadRequestException } from '@nestjs/common';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';
import { mockLoggerFactory } from '../test-utils/logger-mocks';

describe('WorkerRegistrationController', () => {
  let controller: WorkerRegistrationController;
  let service: WorkerRegistrationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkerRegistrationController],
      providers: [
        {
          provide: WorkerRegistrationService,
          useValue: {
            registerWorker: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {},
        },
        {
          provide: LoggerFactory,
          useValue: mockLoggerFactory,
        },
      ],
    }).compile();

    controller = module.get<WorkerRegistrationController>(
      WorkerRegistrationController,
    );
    service = module.get<WorkerRegistrationService>(WorkerRegistrationService);
  });

  describe('registerWorker', () => {
    it('should successfully register a worker and return client id and secret', async () => {
      const registerWorkerDto: RegisterWorkerDto = {
        projectId: 'worker',
      };

      const result = { clientId: '123', clientSecret: 'abc' };
      jest.spyOn(service, 'registerWorker').mockResolvedValue(result as any);

      const response = await controller.registerWorker(registerWorkerDto);

      expect(response).toEqual(result);
      expect(service.registerWorker).toHaveBeenCalledWith(registerWorkerDto);
    });

    it('should throw BadRequestException if service throws an error', async () => {
      const registerWorkerDto: RegisterWorkerDto = {
        projectId: 'worker',
      };

      jest
        .spyOn(service, 'registerWorker')
        .mockRejectedValue(new BadRequestException('Error registering worker'));

      try {
        await controller.registerWorker(registerWorkerDto);
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
      }
    });
  });
});
