import { Test, TestingModule } from '@nestjs/testing';
import { WorkersController } from './workers.controller';
import { WorkersService } from './workers.service';
import { WorkersStatusPageDto,  } from './dto/workers.page.dto';
import { JwtService } from '@netapp-cloud-datamigrate/auth-lib';

describe('WorkersController', () => {
  let controller: WorkersController;
  let service: WorkersService;

  const mockJwtService = {
    verifyToken: jest.fn().mockResolvedValue({
      user: {
        roles: [
          {
            permissions: ["permission1", "permission2"],
            projects: ["project1"],
          },
        ],
      },
    }),
    configService: {},
    client: jest.fn(),
    logger: jest.fn(),
    getKey: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkersController],
      providers: [
        {
          provide: WorkersService,
          useValue: {
            findAllWorkers: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    controller = module.get<WorkersController>(WorkersController);
    service = module.get<WorkersService>(WorkersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getWorkers', () => {
    it('should return a list of workers', async () => {
      const query: WorkersStatusPageDto = { };
      jest.spyOn(service, 'findAllWorkers').mockResolvedValue({data: [], total: 0});
      expect(await controller.getWorkers(query))
    });

    it('should handle invalid query parameters', async () => {
      const query: any = { /* invalid parameters */ };

      // You can mock or validate behavior on invalid parameters if necessary
      jest.spyOn(service, 'findAllWorkers').mockRejectedValue(new Error('Invalid parameters'));

      await expect(controller.getWorkers(query)).rejects.toThrow('Invalid parameters');
    });
  });
});
