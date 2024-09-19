import { Test, TestingModule } from '@nestjs/testing';
import { AgentsService } from './agents.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentEntity } from 'src/entities/agent.entity';
import { AgentsStatusPageDto } from './dto/agents.page.dto';

describe('AgentsService', () => {
  let service: AgentsService;
  let repository: Repository<AgentEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsService,
        {
          provide: getRepositoryToken(AgentEntity),
          useValue: {
            find: jest.fn(),
            count: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AgentsService>(AgentsService);
    repository = module.get<Repository<AgentEntity>>(getRepositoryToken(AgentEntity));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAllAgents', () => {
    it('should return paginated data with count', async () => {
      const agentsStatusPageDto: AgentsStatusPageDto = {
        page: '1',
        limit: '10',
        sort: 'name',
        order: 'asc',
        // additional filters
      };
      const agents = [{ id: '1', name: 'Agent1' }, { id: '2', name: 'Agent2' }];
      const total = 2;

      jest.spyOn(repository, 'find').mockResolvedValue(agents as any);
      jest.spyOn(repository, 'count').mockResolvedValue(total);

      const result = await service.findAllAgents(agentsStatusPageDto);

      expect(result).toEqual({ data: agents, total });
      expect(repository.find).toHaveBeenCalled();
      expect(repository.count).toHaveBeenCalled();
    });

    it('should return data without pagination if no page and limit are provided', async () => {
      const agentsStatusPageDto: AgentsStatusPageDto = {
        sort: 'name',
        order: 'asc',
        // additional filters
      };
      const agents = [{ id: '1', name: 'Agent1' }, { id: '2', name: 'Agent2' }];
      const total = 2;

      jest.spyOn(repository, 'find').mockResolvedValue(agents as any);
      jest.spyOn(repository, 'count').mockResolvedValue(total);

      const result = await service.findAllAgents(agentsStatusPageDto);

      expect(result).toEqual({ data: agents, total });
      expect(repository.find).toHaveBeenCalled();
      expect(repository.count).toHaveBeenCalled();
    });
  });
});
