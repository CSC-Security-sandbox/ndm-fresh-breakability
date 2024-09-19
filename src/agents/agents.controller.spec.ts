import { Test, TestingModule } from '@nestjs/testing';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AgentsStatusPageDto, AgentsStatusPageResponceDto } from './dto/agents.page.dto';
import { ValidationPipe } from '@nestjs/common';

describe('AgentsController', () => {
  let controller: AgentsController;
  let service: AgentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [
        {
          provide: AgentsService,
          useValue: {
            findAllAgents: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AgentsController>(AgentsController);
    service = module.get<AgentsService>(AgentsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAgents', () => {
    it('should return a list of agents', async () => {
      const query: AgentsStatusPageDto = { };
      jest.spyOn(service, 'findAllAgents').mockResolvedValue({data: [], total: 0});
      expect(await controller.getAgents(query))
    });

    it('should handle invalid query parameters', async () => {
      const query: any = { /* invalid parameters */ };

      // You can mock or validate behavior on invalid parameters if necessary
      jest.spyOn(service, 'findAllAgents').mockRejectedValue(new Error('Invalid parameters'));

      await expect(controller.getAgents(query)).rejects.toThrow('Invalid parameters');
    });
  });
});
