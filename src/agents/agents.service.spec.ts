import { Test, TestingModule } from '@nestjs/testing';
import { AgentsService } from './agents.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentEntity } from 'src/entities/agent.entity';
import { AgentsStatusPageDto } from './dto/agents.page.dto';
import { AgentStatus } from 'src/constants/enums';

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
        agentId: '345678',
        agentName: 'test',
        clientId: 'asd',
        ipAddress: '121.12.12.2',
        projectId: '234',
        status: AgentStatus.Online
      };
      const agents = [{ id: '1', name: 'Agent1' }, { id: '2', name: 'Agent2' }];
      const total = 2;

      jest.spyOn(repository, 'find').mockResolvedValueOnce(agents as any);
      jest.spyOn(repository, 'count').mockResolvedValueOnce(total);

      const result = await service.findAllAgents(agentsStatusPageDto);

      // Assertions
      expect(result).toEqual({ data: agents, total });
      expect(repository.find).toHaveBeenCalledWith({
        where: {
          agentId: '345678',
          agentName: 'test',
          clientId: 'asd',
          ipAddress: '121.12.12.2',
          projectId: '234',
          status: AgentStatus.Online,
        },
        order: { name: 'asc' },
        skip: 0,
        take: 10,
      });
      expect(repository.count).toHaveBeenCalledWith({
        where: {
          agentId: '345678',
          agentName: 'test',
          clientId: 'asd',
          ipAddress: '121.12.12.2',
          projectId: '234',
          status: AgentStatus.Online,
        },
      });
    });

    it('should return data without pagination if no page and limit are provided', async () => {
      const agentsStatusPageDto: AgentsStatusPageDto = {
        sort: 'name',
        order: 'asc',
        // additional filters
      };
      const agents = [{ id: '1', name: 'Agent1' }, { id: '2', name: 'Agent2' }];
      const total = 2;

      jest.spyOn(repository, 'find').mockResolvedValueOnce(agents as any);
      jest.spyOn(repository, 'count').mockResolvedValueOnce(total);

      const result = await service.findAllAgents(agentsStatusPageDto);

      // Assertions
      expect(result).toEqual({ data: agents, total });
      expect(repository.find).toHaveBeenCalledWith({
        where: {},
        order: { name: 'asc' },
      });
      expect(repository.count).toHaveBeenCalled();
    });

    it('should return an empty result when no agents are found', async () => {
      const agentsStatusPageDto: AgentsStatusPageDto = { page: '1', limit: '10' };
      jest.spyOn(repository, 'find').mockResolvedValueOnce([]);
      jest.spyOn(repository, 'count').mockResolvedValueOnce(0);

      const result = await service.findAllAgents(agentsStatusPageDto);

      // Assertions
      expect(result).toEqual({ data: [], total: 0 });
      expect(repository.find).toHaveBeenCalled();
      expect(repository.count).toHaveBeenCalled();
    });

    it('should handle repository errors', async () => {
      const agentsStatusPageDto: AgentsStatusPageDto = { page: '1', limit: '10' };
      jest.spyOn(repository, 'find').mockRejectedValueOnce(new Error('Database error'));

      await expect(service.findAllAgents(agentsStatusPageDto)).rejects.toThrow('Database error');
      expect(repository.find).toHaveBeenCalled();
    });
  });
});
