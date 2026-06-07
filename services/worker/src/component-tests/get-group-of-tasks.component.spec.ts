import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { Cmd, CommandStatus, TaskType } from '@netapp-cloud-datamigrate/jobs-lib';
import { CommonTaskService } from '../activities/core/common/common-task.service';
import { AuthService } from '../auth/auth.service';
import { RedisService } from '../redis/redis.service';
import { WorkersConfig } from '../config/app.config';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

/**
 * Real classes wired:
 *   CommonTaskService → real `buildTask` (from core/utils/utils)
 *                     + real `calculateCommandHash` (from utils/utils)
 *                     + real `calculateHash` (from checksum-utils)
 *
 * Mocked boundaries:
 *   RedisService.getJobManagerContext → returns a fake JobManagerContext
 */

const mockLogger = {
  log: jest.fn(), error: jest.fn(), warn: jest.fn(),
  debug: jest.fn(), verbose: jest.fn(), setContext: jest.fn(),
};
const mockLoggerFactory: LoggerFactory = { create: jest.fn().mockReturnValue(mockLogger) } as any;

const COMMANDS_IN_TASK = 3;
const GROUP_SIZE       = 100;

const mockConfigService = {
  get: jest.fn((key: string) => {
    const map: Record<string, any> = {
      'worker.workerId':          'worker-1',
      'worker.maxRetryCount':     3,
      'worker.groupSize':         GROUP_SIZE,
      'worker.commandsInTask':    COMMANDS_IN_TASK,
      'worker.maxCmdStreamLen':   5000,
      'temporal.address':         'localhost:7233',
      'worker.projectId':         'proj-abc',
      'keycloak': { baseUrl: 'http://keycloak', realm: 'ndm', workerSecret: 'secret' },
    };
    return map[key];
  }),
};

const mockHttpService = {
  post: jest.fn().mockReturnValue(
    of({ data: { access_token: 'token-abc', expires_in: 300 } }),
  ),
};

function makeCmd(id: string): Cmd {
  return new Cmd(id, `/path/${id}`, CommandStatus.READY, false, {});
}

function makeJobContext(cmdsPerRead: Cmd[][] = [], ackFn = jest.fn().mockResolvedValue(undefined)) {
  const jobConfig = {
    workerIds: ['worker-1'],
    sourceFileServer: { pathId: 'src-path' },
    destinationFileServer: { pathId: 'dst-path' },
  };

  async function* streamGenerator() {
    for (const batch of cmdsPerRead) {
      for (const cmd of batch) {
        yield { data: cmd, id: `stream-${cmd.id}` };
      }
    }
  }

  return {
    jobConfig,
    groupReadCommandStream: jest.fn().mockReturnValue(streamGenerator()),
    groupAckCommandStream:  ackFn,
    setTaskIfNotExists:     jest.fn().mockResolvedValue(undefined),
    setBatchDir:            jest.fn().mockResolvedValue(undefined),
    getBatchDir:            jest.fn().mockResolvedValue(null),
  };
}

describe('Component: getGroupOfTasksActivity (CommonTaskService)', () => {
  let service: CommonTaskService;
  let mockRedisService: { getJobManagerContext: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    new WorkersConfig(mockConfigService as any);

    mockRedisService = { getJobManagerContext: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonTaskService,
        AuthService,
        { provide: ConfigService,  useValue: mockConfigService },
        { provide: LoggerFactory,  useValue: mockLoggerFactory },
        { provide: HttpService,    useValue: mockHttpService },
        { provide: RedisService,   useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<CommonTaskService>(CommonTaskService);
  });

  it('H1 — Stream returns exactly commandsInTask commands — verify exactly one TaskInfo is built via the real buildTask + calculateCommandHash chain, written to Redis via setTaskIfNotExists, and its hash key is returned in taskIds', async () => {
    const cmds = [makeCmd('a1'), makeCmd('a2'), makeCmd('a3')];
    const ctx  = makeJobContext([cmds]);
    mockRedisService.getJobManagerContext.mockResolvedValue(ctx);

    const taskIds = await service.getGroupOfTasksActivity('job-g01');

    expect(taskIds).toHaveLength(1);
    expect(ctx.setTaskIfNotExists).toHaveBeenCalledTimes(1);
    const [storedHash] = (ctx.setTaskIfNotExists as jest.Mock).mock.calls[0];
    expect(taskIds[0]).toBe(storedHash);
  });

  it('H2 — Stream returns more commands than commandsInTask — verify the loop creates multiple tasks, each with the correct subset of commands, and all hash keys are returned', async () => {
    const cmds = Array.from({ length: 7 }, (_, i) => makeCmd(`b${i}`));
    const ctx  = makeJobContext([cmds]);
    mockRedisService.getJobManagerContext.mockResolvedValue(ctx);

    const taskIds = await service.getGroupOfTasksActivity('job-g02');

    expect(taskIds.length).toBe(3);
    expect(ctx.setTaskIfNotExists).toHaveBeenCalledTimes(3);
  });

  it('H3 — Remainder batch — stream returns a number of commands that is not a multiple of commandsInTask — verify the leftover commands after the loop are still bundled into a final task and included in the returned IDs', async () => {
    const cmds = Array.from({ length: 5 }, (_, i) => makeCmd(`c${i}`));
    const ctx  = makeJobContext([cmds]);
    mockRedisService.getJobManagerContext.mockResolvedValue(ctx);

    const taskIds = await service.getGroupOfTasksActivity('job-g03');

    expect(taskIds).toHaveLength(2);
    expect(ctx.setTaskIfNotExists).toHaveBeenCalledTimes(2);
  });

  it('H4 — All tasks are written to Redis in parallel via Promise.all before the stream is acknowledged — verify groupAckCommandStream is only called after all setTaskIfNotExists calls complete', async () => {
    const callOrder: string[] = [];
    const cmds = [makeCmd('d1'), makeCmd('d2'), makeCmd('d3')];
    const setFn = jest.fn().mockImplementation(() => { callOrder.push('set'); return Promise.resolve(); });
    const ackFn = jest.fn().mockImplementation(() => { callOrder.push('ack'); return Promise.resolve(); });
    const ctx = makeJobContext([cmds], ackFn);
    (ctx.setTaskIfNotExists as jest.Mock) = setFn;
    mockRedisService.getJobManagerContext.mockResolvedValue(ctx);

    await service.getGroupOfTasksActivity('job-g04');

    expect(callOrder.lastIndexOf('set')).toBeLessThan(callOrder.indexOf('ack'));
  });

  it('H5 — Stream is empty — verify getGroupOfTasksActivity returns an empty array and neither setTaskIfNotExists nor groupAckCommandStream is called', async () => {
    const ctx = makeJobContext([]);
    mockRedisService.getJobManagerContext.mockResolvedValue(ctx);

    const taskIds = await service.getGroupOfTasksActivity('job-g05');

    expect(taskIds).toEqual([]);
    expect(ctx.setTaskIfNotExists).not.toHaveBeenCalled();
    expect(ctx.groupAckCommandStream).not.toHaveBeenCalled();
  });

  it('N1 — getJobManagerContext or the stream read throws — verify the error is caught, wrapped as "Failed to get group of tasks activity: …", and re-thrown', async () => {
    mockRedisService.getJobManagerContext.mockRejectedValue(new Error('Redis unavailable'));

    await expect(service.getGroupOfTasksActivity('job-g06')).rejects.toThrow(
      'Failed to get group of tasks activity',
    );
  });
});
