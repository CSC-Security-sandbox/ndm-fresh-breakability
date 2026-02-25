import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MigrationConflictService } from './migration-conflict.service';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobRunEntity } from '../entities/jobrun.entity';
import { JobRunStatus, JobStatus, JobType } from '../constants/enums';
import { MigrationConflictCheckData } from './types';

/**
 * MigrationConflictService checks migrate configs for three conflict types:
 * - circular: existing job's source = new config's destination and existing job's target = new config's source (export level only; directory not required)
 * - destination: existing job uses the same destination path (with overlapping directory)
 * - source: same source path with overlapping source directories (parent-child)
 * Directory paths in conflict results are null when export-level (no subdirectory).
 *
 * Test convention: "Our config" = the migration config being checked. "Existing job" = active job from DB.
 * Conflict result describes the existing job: sourcePathId = that job's source, targetPathId = that job's destination.
 */
describe('MigrationConflictService', () => {
    let service: MigrationConflictService;
    let jobConfigRepository: Repository<JobConfigEntity>;
    let jobRunRepository: Repository<JobRunEntity>;

    const mockJobConfigRepository = {
        find: jest.fn(),
        findOne: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
        delete: jest.fn(),
    };

    const mockJobRunRepository = {
        find: jest.fn(),
        findOne: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
        delete: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                MigrationConflictService,
                {
                    provide: getRepositoryToken(JobConfigEntity),
                    useValue: mockJobConfigRepository,
                },
                {
                    provide: getRepositoryToken(JobRunEntity),
                    useValue: mockJobRunRepository,
                },
            ],
        }).compile();

        service = module.get<MigrationConflictService>(MigrationConflictService);
        jobConfigRepository = module.get<Repository<JobConfigEntity>>(
            getRepositoryToken(JobConfigEntity),
        );
        jobRunRepository = module.get<Repository<JobRunEntity>>(
            getRepositoryToken(JobRunEntity),
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('checkMigrationConflicts', () => {
        it('returns empty array and does not call repository when migrateConfigs is empty', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [],
            };

            const result = await service.checkMigrationConflicts(data);

            expect(result).toEqual([]);
            expect(mockJobConfigRepository.find).not.toHaveBeenCalled();
        });

        it('returns empty array when no active jobs create circular, destination, or source conflicts', async () => {
            // Our config: source source-1 → destination dest-1 (no conflicting jobs in DB)
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                    },
                ],
            };

            mockJobConfigRepository.find.mockResolvedValue([]);

            const result = await service.checkMigrationConflicts(data);

            expect(result).toEqual([]);
            expect(mockJobConfigRepository.find).toHaveBeenCalledWith({
                where: {
                    jobType: expect.any(Object), // In([JobType.MIGRATE, JobType.CUT_OVER])
                    status: JobStatus.Active,
                    sourcePathId: expect.any(Object), // In() matcher
                    targetPathId: 'source-1',
                },
                relations: [
                    'jobRuns',
                    'targetPath',
                    'sourcePath',
                    'sourcePath.fileServer.config',
                    'targetPath.fileServer.config',
                ],
            });
        });

        it('returns one conflict with type circular when an active job has source=our destination and target=our source', async () => {
            // Our config (being checked): source source-1 → destination dest-1
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                    },
                ],
            };

            const mockJobRuns = [
                { id: 'run-1', status: JobRunStatus.Running },
                { id: 'run-2', status: JobRunStatus.Pending },
            ];

            // Existing job: source dest-1 (our destination) → target source-1 (our source) => circular
            const mockConflictingJob = {
                id: 'job-1',
                status: JobStatus.Active,
                jobType: JobType.MIGRATE,
                jobRuns: mockJobRuns,
                sourcePathId: 'dest-1',
                targetPathId: 'source-1',
                targetPath: {
                    volumePath: '/target/path',   // existing job's destination (= our source volume)
                    fileServer: { config: { configName: 'target-server' } },
                },
                sourcePath: {
                    volumePath: '/source/path',   // existing job's source (= our destination volume)
                    fileServer: { config: { configName: 'source-server' } },
                },
            };

            mockJobConfigRepository.find.mockResolvedValueOnce([mockConflictingJob])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            const result = await service.checkMigrationConflicts(data);

            expect(result).toHaveLength(1);
            // Conflict result: sourcePathId = job's target (= our source), targetPathId = job's source (= our destination)
            expect(result[0]).toEqual({
                status: 'ACTIVE',
                jobId: 'job-1',
                sourcePathId: '/target/path',   // job's target (= our source)
                targetPathId: '/source/path',   // job's source (= our destination)
                sourceServerId: 'source-server',
                targetServerId: 'target-server',
                conflictType: 'circular',
                jobType: JobType.MIGRATE,
            });
        });

        it('returns circular conflict when conflicting job has no active runs (conflict is based on config, not runs)', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                    },
                ],
            };

            const mockJobRuns = [
                { id: 'run-1', status: JobRunStatus.Completed },
                { id: 'run-2', status: JobRunStatus.Failed },
            ];

            const mockConflictingJob = {
                id: 'job-1',
                status: JobStatus.Active,
                jobType: JobType.MIGRATE,
                jobRuns: mockJobRuns,
                targetPath: {
                    volumePath: '/target/path',
                    fileServer: { config: { configName: 'target-server' } },
                },
                sourcePath: {
                    volumePath: '/source/path',
                    fileServer: { config: { configName: 'source-server' } },
                },
            };

            // First call returns the conflicting job, second call returns empty array, third call empty
            mockJobConfigRepository.find.mockResolvedValueOnce([mockConflictingJob])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            const result = await service.checkMigrationConflicts(data);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                status: 'ACTIVE',
                jobId: 'job-1',
                sourcePathId: '/target/path',
                targetPathId: '/source/path',
                sourceServerId: 'source-server',
                targetServerId: 'target-server',
                conflictType: 'circular',
                jobType: JobType.MIGRATE,
            });
        });

        it('runs three find calls per config (circular, destination, source) and returns empty when no conflicts', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                    },
                    {
                        sourcePathId: 'source-2',
                        destinationPathId: ['dest-2', 'dest-3'],
                    },
                ],
            };

            mockJobConfigRepository.find.mockResolvedValue([]);

            const result = await service.checkMigrationConflicts(data);

            expect(result).toEqual([]);
            expect(mockJobConfigRepository.find).toHaveBeenCalledTimes(6); // 2 configs * 3 queries each (circular + destination + source path)
        });
        
        it('returns one conflict with type destination when an active job uses the same destination path', async () => {
            // Our config: source source-1 → destination dest-1
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                    },
                ],
            };

            const mockJobRuns = [
                { id: 'run-1', status: JobRunStatus.Running },
                { id: 'run-2', status: JobRunStatus.Pending },
            ];

            // Existing job: source different-source → destination dest-1 (same as our destination) => destination conflict
            const mockDestinationPathConflictingJob = {
                id: 'job-2',
                status: JobStatus.Active,
                jobType: JobType.CUT_OVER,
                sourcePathId: 'different-source',
                targetPathId: 'dest-1',
                jobRuns: mockJobRuns,
                targetPath: {
                    volumePath: 'dest-1',   // job's destination = our destination
                    fileServer: { config: { configName: 'dest-server' } },
                },
                sourcePath: {
                    volumePath: '/some/other/source',   // job's source (different from ours)
                    fileServer: { config: { configName: 'other-source-server' } },
                },
            };

            mockJobConfigRepository.find.mockResolvedValueOnce([])
                .mockResolvedValueOnce([mockDestinationPathConflictingJob])
                .mockResolvedValueOnce([]);

            const result = await service.checkMigrationConflicts(data);

            expect(result).toHaveLength(1);
            // Conflict result: describes existing job (its source, its destination)
            expect(result[0]).toEqual({
                status: 'ACTIVE',
                jobId: 'job-2',
                sourcePathId: '/some/other/source',   // job's source
                targetPathId: 'dest-1',               // job's destination (= our destination, conflict)
                sourceServerId: 'other-source-server',
                targetServerId: 'dest-server',
                conflictType: 'destination',
                jobType: JobType.CUT_OVER,
                sourceDirectoryPath: null,
                targetDirectoryPath: null,
            });

            // Verify the correct queries were made (3: circular, destination, source path)
            expect(mockJobConfigRepository.find).toHaveBeenCalledTimes(3);
            
            // First call: traditional circular dependency check
            expect(mockJobConfigRepository.find).toHaveBeenNthCalledWith(1, {
                where: {
                    jobType: expect.any(Object),
                    status: JobStatus.Active,
                    sourcePathId: expect.any(Object),
                    targetPathId: 'source-1',
                },
                relations: [
                    'jobRuns',
                    'targetPath',
                    'sourcePath',
                    'sourcePath.fileServer.config',
                    'targetPath.fileServer.config',
                ],
            });

            // Second call: destination path conflict check (no status filter)
            expect(mockJobConfigRepository.find).toHaveBeenNthCalledWith(2, {
                where: {
                    jobType: expect.any(Object),
                    targetPathId: expect.any(Object),
                },
                relations: [
                    'jobRuns',
                    'targetPath',
                    'sourcePath',
                    'sourcePath.fileServer.config',
                    'targetPath.fileServer.config',
                ],
            });
        });

        it('throws when repository find fails', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                    },
                ],
            };

            mockJobConfigRepository.find.mockRejectedValue(new Error('Database error'));

            try {
                await service.checkMigrationConflicts(data);
                expect(true).toBe(false); // Should not reach here
            } catch (error) {
                expect(error.message).toBe('Failed to check migration conflicts: Error: Database error');
            }
        });
    });

    describe('verifyMigrationConflicts', () => {
        it('delegates to checkMigrationConflicts and returns its result', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [],
            };

            const spy = jest.spyOn(service, 'checkMigrationConflicts').mockResolvedValue([]);

            const result = await service.verifyMigrationConflicts(data);

            expect(spy).toHaveBeenCalledWith(data);
            expect(result).toEqual([]);
        });
    });

    describe('checkCircularDependency', () => {
        it('should delegate to checkMigrationConflicts and return same result', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [{ sourcePathId: 'src-1', destinationPathId: ['dest-1'] }],
            };
            mockJobConfigRepository.find.mockResolvedValue([]);
            const result = await service.checkCircularDependency(data);
            expect(result).toEqual([]);
            expect(mockJobConfigRepository.find).toHaveBeenCalled();
        });
    });

    describe('verifyCircularTaskDependency', () => {
        it('should delegate to checkMigrationConflicts and return same result', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [{ sourcePathId: 'src-1', destinationPathId: ['dest-1'] }],
            };
            mockJobConfigRepository.find.mockResolvedValue([]);
            const result = await service.verifyCircularTaskDependency(data);
            expect(result).toEqual([]);
            expect(mockJobConfigRepository.find).toHaveBeenCalled();
        });
    });

    describe('hasCircularDependencies', () => {
        it('should return true when conflicts exist', async () => {
            jest.spyOn(service, 'checkMigrationConflicts').mockResolvedValue([
                { jobId: 'j1', conflictType: 'circular' } as any,
            ]);
            const result = await service.hasCircularDependencies({
                migrateConfigs: [{ sourcePathId: 's', destinationPathId: ['d'] }],
            });
            expect(result).toBe(true);
        });

        it('should return false when no conflicts exist', async () => {
            jest.spyOn(service, 'checkMigrationConflicts').mockResolvedValue([]);
            const result = await service.hasCircularDependencies({
                migrateConfigs: [{ sourcePathId: 's', destinationPathId: ['d'] }],
            });
            expect(result).toBe(false);
        });
    });

    describe('getCircularDependencyDetails', () => {
        it('should call checkMigrationConflicts with formatted migrateConfigs', async () => {
            const spy = jest.spyOn(service, 'checkMigrationConflicts').mockResolvedValue([]);
            await service.getCircularDependencyDetails('source-1', ['dest-1', 'dest-2']);
            expect(spy).toHaveBeenCalledWith({
                migrateConfigs: [
                    { sourcePathId: 'source-1', destinationPathId: ['dest-1', 'dest-2'] },
                ],
            });
        });
    });

    describe('hasMigrationConflicts', () => {
        it('returns true when checkMigrationConflicts returns at least one conflict', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                    },
                ],
            };

            const mockDependency = {
                status: 'ACTIVE',
                jobId: 'job-1',
                sourcePathId: '/source/path',
                targetPathId: '/target/path',
                sourceServerId: 'source-server',
                targetServerId: 'target-server',
                conflictType: 'circular' as const,
                jobType: JobType.MIGRATE,
            };

            jest.spyOn(service, 'checkMigrationConflicts').mockResolvedValue([mockDependency]);

            const result = await service.hasMigrationConflicts(data);

            expect(result).toBe(true);
        });

        it('returns false when checkMigrationConflicts returns empty array', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                    },
                ],
            };

            jest.spyOn(service, 'checkMigrationConflicts').mockResolvedValue([]);

            const result = await service.hasMigrationConflicts(data);

            expect(result).toBe(false);
        });
    });

    describe('getMigrationConflictDetails', () => {
        it('builds migrateConfigs from sourcePathId and destinationPathIds and returns checkMigrationConflicts result', async () => {
            const sourcePathId = 'source-1';
            const destinationPathIds = ['dest-1', 'dest-2'];

            const expectedData: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1', 'dest-2'],
                    },
                ],
            };

            const spy = jest.spyOn(service, 'checkMigrationConflicts').mockResolvedValue([]);

            const result = await service.getMigrationConflictDetails(
                sourcePathId,
                destinationPathIds,
            );

            expect(spy).toHaveBeenCalledWith(expectedData);
            expect(result).toEqual([]);
        });
    });

    describe('checkMigrationConflicts (circular with no job runs)', () => {
        it('returns circular conflict when conflicting job has empty jobRuns array', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                    },
                ],
            };

            const mockConflictingJob = {
                id: 'job-1',
                status: JobStatus.Active,
                jobType: JobType.MIGRATE,
                jobRuns: [], // No job runs
                targetPath: {
                    volumePath: '/target/path',
                    fileServer: { config: { configName: 'target-server' } },
                },
                sourcePath: {
                    volumePath: '/source/path',
                    fileServer: { config: { configName: 'source-server' } },
                },
            };

            mockJobConfigRepository.find.mockResolvedValueOnce([mockConflictingJob])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            const result = await service.checkMigrationConflicts(data);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                status: 'ACTIVE',
                jobId: 'job-1',
                sourcePathId: '/target/path',
                targetPathId: '/source/path',
                sourceServerId: 'source-server',
                targetServerId: 'target-server',
                conflictType: 'circular',
                jobType: JobType.MIGRATE,
            });
        });

        it('returns circular conflict when conflicting job has mixed run statuses', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                    },
                ],
            };

            const mockJobRuns = [
                { id: 'run-1', status: JobRunStatus.Running },
                { id: 'run-2', status: JobRunStatus.Completed },
                { id: 'run-3', status: JobRunStatus.Pending },
            ];

            const mockConflictingJob = {
                id: 'job-1',
                status: JobStatus.Active,
                jobType: JobType.MIGRATE,
                jobRuns: mockJobRuns,
                targetPath: {
                    volumePath: '/target/path',
                    fileServer: { config: { configName: 'target-server' } },
                },
                sourcePath: {
                    volumePath: '/source/path',
                    fileServer: { config: { configName: 'source-server' } },
                },
            };

            mockJobConfigRepository.find.mockResolvedValueOnce([mockConflictingJob])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            const result = await service.checkMigrationConflicts(data);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                status: 'ACTIVE',
                jobId: 'job-1',
                sourcePathId: '/target/path',
                targetPathId: '/source/path',
                sourceServerId: 'source-server',
                targetServerId: 'target-server',
                conflictType: 'circular',
                jobType: JobType.MIGRATE,
            });
        });
    });

    describe('Edge cases and error scenarios', () => {
        it('returns empty array when destinationPathId is empty', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: [],
                    },
                ],
            };

            mockJobConfigRepository.find.mockResolvedValue([]);

            const result = await service.checkMigrationConflicts(data);

            expect(result).toEqual([]);
        });

        it('returns multiple conflicts when several jobs create circular dependency for one config', async () => {
            // Our config: source source-1 → destination dest-1
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                    },
                ],
            };

            // Two existing jobs, both with source dest-1 → target source-1 (circular with our config)
            const mockConflictingJobs = [
                {
                    id: 'job-1',
                    status: JobStatus.Active,
                    jobType: JobType.MIGRATE,
                    jobRuns: [{ id: 'run-1', status: JobRunStatus.Running }],
                    targetPath: {
                        volumePath: '/target/path/1',
                        fileServer: { config: { configName: 'target-server-1' } },
                    },
                    sourcePath: {
                        volumePath: '/source/path/1',
                        fileServer: { config: { configName: 'source-server-1' } },
                    },
                },
                {
                    id: 'job-2',
                    status: JobStatus.Active,
                    jobType: JobType.CUT_OVER,
                    jobRuns: [{ id: 'run-2', status: JobRunStatus.Pending }],
                    targetPath: {
                        volumePath: '/target/path/2',
                        fileServer: { config: { configName: 'target-server-2' } },
                    },
                    sourcePath: {
                        volumePath: '/source/path/2',
                        fileServer: { config: { configName: 'source-server-2' } },
                    },
                },
            ];

            mockJobConfigRepository.find.mockResolvedValueOnce(mockConflictingJobs)
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            const result = await service.checkMigrationConflicts(data);

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                status: 'ACTIVE',
                jobId: 'job-1',
                sourcePathId: '/target/path/1',
                targetPathId: '/source/path/1',
                sourceServerId: 'source-server-1',
                targetServerId: 'target-server-1',
                conflictType: 'circular',
                jobType: JobType.MIGRATE,
            });
            expect(result[1]).toEqual({
                status: 'ACTIVE',
                jobId: 'job-2',
                sourcePathId: '/target/path/2',
                targetPathId: '/source/path/2',
                sourceServerId: 'source-server-2',
                targetServerId: 'target-server-2',
                conflictType: 'circular',
                jobType: JobType.CUT_OVER,
            });
        });

        it('returns both circular and destination conflicts when different jobs cause each', async () => {
            // Our config: source source-1 → destinations dest-1, dest-2
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1', 'dest-2'],
                    },
                ],
            };

            // Existing job 1: source dest-1 (our dest) → target source-1 (our source) => circular
            const mockTraditionalConflictingJob = {
                id: 'job-traditional',
                status: JobStatus.Active,
                jobType: JobType.MIGRATE,
                sourcePathId: 'dest-1',
                targetPathId: 'source-1',
                jobRuns: [{ id: 'run-traditional', status: JobRunStatus.Running }],
                targetPath: {
                    volumePath: '/target/traditional',   // job's destination (= our source)
                    fileServer: { config: { configName: 'target-traditional-server' } },
                },
                sourcePath: {
                    volumePath: '/source/traditional',   // job's source (= our destination)
                    fileServer: { config: { configName: 'source-traditional-server' } },
                },
            };

            // Existing job 2: source different-source → destination dest-2 (our destination) => destination conflict
            const mockDestinationConflictingJob = {
                id: 'job-destination',
                status: JobStatus.Active,
                jobType: JobType.CUT_OVER,
                sourcePathId: 'different-source',
                targetPathId: 'dest-2',
                jobRuns: [{ id: 'run-destination', status: JobRunStatus.Pending }],
                targetPath: {
                    volumePath: 'dest-2',   // job's destination = our destination
                    fileServer: { config: { configName: 'dest-conflict-server' } },
                },
                sourcePath: {
                    volumePath: '/some/other/source',   // job's source
                    fileServer: { config: { configName: 'other-source-server' } },
                },
            };

            mockJobConfigRepository.find.mockResolvedValueOnce([mockTraditionalConflictingJob])
                .mockResolvedValueOnce([mockDestinationConflictingJob])
                .mockResolvedValueOnce([]);

            const result = await service.checkMigrationConflicts(data);

            expect(result).toHaveLength(2);
            // Conflict 1 (circular): existing job's source/destination
            expect(result[0]).toEqual({
                status: 'ACTIVE',
                jobId: 'job-traditional',
                sourcePathId: '/target/traditional',   // job's source
                targetPathId: '/source/traditional',   // job's destination
                sourceServerId: 'source-traditional-server',
                targetServerId: 'target-traditional-server',
                conflictType: 'circular',
                jobType: JobType.MIGRATE,
            });
            // Conflict 2 (destination): existing job's source/destination
            expect(result[1]).toEqual({
                status: 'ACTIVE',
                jobId: 'job-destination',
                sourcePathId: '/some/other/source',   // job's source
                targetPathId: 'dest-2',               // job's destination (= our destination)
                sourceServerId: 'other-source-server',
                targetServerId: 'dest-conflict-server',
                conflictType: 'destination',
                jobType: JobType.CUT_OVER,
                sourceDirectoryPath: null,
                targetDirectoryPath: null,
            });
        });

        it('returns no conflict when circular would exist but the conflicting job is inactive', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                    },
                ],
            };

            // This test demonstrates that we can create a circular config when the dependent job is inactive
            // The circular job exists but is inactive: dest-1 -> source-1 (which would conflict with source-1 -> dest-1)
            const mockInactiveCircularJob = {
                id: 'job-inactive-circular',
                status: JobStatus.InActive, // This job is INACTIVE
                jobType: JobType.MIGRATE,
                sourcePathId: 'dest-1', // Uses our destination as its source
                targetPathId: 'source-1', // Uses our source as its target - this would be circular if active
                jobRuns: [{ id: 'run-inactive', status: JobRunStatus.Completed }],
                targetPath: {
                    volumePath: '/target/inactive',
                    fileServer: { config: { configName: 'target-inactive-server' } },
                },
                sourcePath: {
                    volumePath: '/source/inactive',
                    fileServer: { config: { configName: 'source-inactive-server' } },
                },
            };

            mockJobConfigRepository.find.mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            const result = await service.checkMigrationConflicts(data);

            expect(result).toEqual([]); // No conflicts found - can create the config because circular job is inactive
            
            // Verify the service only queries for ACTIVE jobs in circular dependency check
            expect(mockJobConfigRepository.find).toHaveBeenNthCalledWith(1, {
                where: {
                    jobType: expect.any(Object),
                    status: JobStatus.Active, // This excludes our inactive circular job
                    sourcePathId: expect.any(Object), // Would match ['dest-1'] 
                    targetPathId: 'source-1', // Would match the inactive job's target if it were active
                },
                relations: [
                    'jobRuns',
                    'targetPath',
                    'sourcePath',
                    'sourcePath.fileServer.config',
                    'targetPath.fileServer.config',
                ],
            });
        });

        it('returns circular conflict when the conflicting job is active', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                    },
                ],
            };

            // Same circular job as above test, but this time it's ACTIVE
            const mockActiveCircularJob = {
                id: 'job-active-circular',
                status: JobStatus.Active, // This job is ACTIVE now
                jobType: JobType.MIGRATE,
                sourcePathId: 'dest-1', // Uses our destination as its source
                targetPathId: 'source-1', // Uses our source as its target - circular dependency!
                jobRuns: [{ id: 'run-active', status: JobRunStatus.Running }],
                targetPath: {
                    volumePath: '/target/active',
                    fileServer: { config: { configName: 'target-active-server' } },
                },
                sourcePath: {
                    volumePath: '/source/active',
                    fileServer: { config: { configName: 'source-active-server' } },
                },
            };

            mockJobConfigRepository.find.mockResolvedValueOnce([mockActiveCircularJob])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            const result = await service.checkMigrationConflicts(data);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                status: 'ACTIVE',
                jobId: 'job-active-circular',
                sourcePathId: '/target/active',
                targetPathId: '/source/active',
                sourceServerId: 'source-active-server',
                targetServerId: 'target-active-server',
                conflictType: 'circular',
                jobType: JobType.MIGRATE,
            });
        });

        it('returns one conflict with type source when same source path has overlapping source directories (parent-child)', async () => {
            // Our config: source source-1 /data → destination dest-1
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        sourceDirectoryPath: '/data',
                        destinationPathId: ['dest-1'],
                    },
                ],
            };

            // Existing job: same source source-1 but dir /data/sub (parent-child of our /data) → destination dest-other => source conflict
            const mockSourcePathConflictingJob = {
                id: 'job-source-overlap',
                status: JobStatus.Active,
                jobType: JobType.MIGRATE,
                sourcePathId: 'source-1',
                sourceDirectoryPath: '/data/sub',
                targetPathId: 'dest-other',
                targetPath: {
                    volumePath: '/dest/other',   // job's destination
                    fileServer: { config: { configName: 'dest-other-server' } },
                },
                sourcePath: {
                    volumePath: '/export/source1',   // job's source (= our source, overlap /data vs /data/sub)
                    fileServer: { config: { configName: 'source-server' } },
                },
            };

            mockJobConfigRepository.find.mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([mockSourcePathConflictingJob]);

            const result = await service.checkMigrationConflicts(data);

            expect(result).toHaveLength(1);
            // Conflict result: describes existing job (source path, destination path, source dir)
            expect(result[0]).toEqual({
                status: 'ACTIVE',
                jobId: 'job-source-overlap',
                sourcePathId: '/export/source1',   // job's source (= our source)
                targetPathId: '/dest/other',      // job's destination
                sourceServerId: 'source-server',
                targetServerId: 'dest-other-server',
                conflictType: 'source',
                jobType: JobType.MIGRATE,
                sourceDirectoryPath: '/data/sub',
                targetDirectoryPath: null,
            });
            expect(mockJobConfigRepository.find).toHaveBeenNthCalledWith(3, {
                where: {
                    jobType: expect.any(Object),
                    status: JobStatus.Active,
                    sourcePathId: 'source-1',
                },
                relations: [
                    'targetPath',
                    'sourcePath',
                    'sourcePath.fileServer.config',
                    'targetPath.fileServer.config',
                ],
            });
        });

        it('returns no source conflict when same source path and same source directory (exact duplicate allowed)', async () => {
            // Our config: source source-1 /data → destination dest-1
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        sourceDirectoryPath: '/data',
                        destinationPathId: ['dest-1'],
                    },
                ],
            };

            // Existing job: same source source-1 /data, same destination dest-1 => exact duplicate, no conflict
            const mockSameSourceJob = {
                id: 'job-same',
                status: JobStatus.Active,
                jobType: JobType.MIGRATE,
                sourcePathId: 'source-1',
                sourceDirectoryPath: '/data',
                targetPathId: 'dest-1',
                targetPath: {
                    volumePath: '/dest/1',
                    fileServer: { config: { configName: 'dest-server' } },
                },
                sourcePath: {
                    volumePath: '/export/source1',
                    fileServer: { config: { configName: 'source-server' } },
                },
            };

            mockJobConfigRepository.find.mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([mockSameSourceJob]);

            const result = await service.checkMigrationConflicts(data);

            expect(result).toHaveLength(0);
        });
    });

    describe('Directory overlap and exact duplicate', () => {
        it('reports circular conflict at export level even when source/destination directories do not overlap', async () => {
            // Circular is defined at export level only; directory path is not required for the conflict.
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                        sourceDirectoryPath: '/data',
                        destinationDirectoryPath: '/dest',
                    },
                ],
            };
            const mockConflictingJob = {
                id: 'job-1',
                status: JobStatus.Active,
                jobType: JobType.MIGRATE,
                sourcePathId: 'dest-1',
                targetPathId: 'source-1',
                sourceDirectoryPath: '/src',
                targetDirectoryPath: '/other', // does not overlap with /data
                jobRuns: [],
                targetPath: {
                    volumePath: '/target/path',
                    fileServer: { config: { configName: 'target-server' } },
                },
                sourcePath: {
                    volumePath: '/source/path',
                    fileServer: { config: { configName: 'source-server' } },
                },
            };
            mockJobConfigRepository.find.mockResolvedValueOnce([mockConflictingJob]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
            const result = await service.checkMigrationConflicts(data);
            expect(result).toHaveLength(1);
            expect(result[0].conflictType).toBe('circular');
        });

        it('should report circular conflict when source dir and job target dir overlap (parent/child)', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                        sourceDirectoryPath: '/data',
                        destinationDirectoryPath: '/dest',
                    },
                ],
            };
            const mockConflictingJob = {
                id: 'job-1',
                status: JobStatus.Active,
                jobType: JobType.MIGRATE,
                sourcePathId: 'dest-1',
                targetPathId: 'source-1',
                sourceDirectoryPath: '/src',
                targetDirectoryPath: '/data/sub',
                jobRuns: [],
                targetPath: {
                    volumePath: '/target/path',
                    fileServer: { config: { configName: 'target-server' } },
                },
                sourcePath: {
                    volumePath: '/source/path',
                    fileServer: { config: { configName: 'source-server' } },
                },
            };
            mockJobConfigRepository.find.mockResolvedValueOnce([mockConflictingJob]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
            const result = await service.checkMigrationConflicts(data);
            expect(result).toHaveLength(1);
            expect(result[0].conflictType).toBe('circular');
        });

        it('should not report destination conflict when destination dir and job target dir do not overlap', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                        sourceDirectoryPath: '/src',
                        destinationDirectoryPath: '/dest',
                    },
                ],
            };
            const mockDestJob = {
                id: 'job-2',
                status: JobStatus.Active,
                jobType: JobType.MIGRATE,
                sourcePathId: 'other-source',
                targetPathId: 'dest-1',
                sourceDirectoryPath: '/osrc',
                targetDirectoryPath: '/other', // no overlap with /dest
                jobRuns: [],
                targetPath: {
                    volumePath: '/dest/path',
                    fileServer: { config: { configName: 'dest-server' } },
                },
                sourcePath: {
                    volumePath: '/other/source',
                    fileServer: { config: { configName: 'other-server' } },
                },
            };
            mockJobConfigRepository.find.mockResolvedValueOnce([]).mockResolvedValueOnce([mockDestJob]).mockResolvedValueOnce([]);
            const result = await service.checkMigrationConflicts(data);
            expect(result).toHaveLength(0);
        });

        it('should not report destination conflict when exact duplicate (same source path, same source dir, same dest dir)', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                        sourceDirectoryPath: '/src',
                        destinationDirectoryPath: '/dest',
                    },
                ],
            };
            const mockExactDuplicateJob = {
                id: 'job-dup',
                status: JobStatus.Active,
                jobType: JobType.MIGRATE,
                sourcePathId: 'source-1',
                targetPathId: 'dest-1',
                sourceDirectoryPath: '/src',
                targetDirectoryPath: '/dest',
                jobRuns: [],
                targetPath: {
                    volumePath: '/dest/vol',
                    fileServer: { config: { configName: 'dest-srv' } },
                },
                sourcePath: {
                    volumePath: '/src/vol',
                    fileServer: { config: { configName: 'src-srv' } },
                },
            };
            mockJobConfigRepository.find.mockResolvedValueOnce([]).mockResolvedValueOnce([mockExactDuplicateJob]).mockResolvedValueOnce([]);
            const result = await service.checkMigrationConflicts(data);
            expect(result).toHaveLength(0);
        });

        it('should report destination conflict when directories overlap but not exact duplicate', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                        sourceDirectoryPath: '/src',
                        destinationDirectoryPath: '/data',
                    },
                ],
            };
            const mockOverlapJob = {
                id: 'job-overlap',
                status: JobStatus.Active,
                jobType: JobType.MIGRATE,
                sourcePathId: 'other-source',
                targetPathId: 'dest-1',
                sourceDirectoryPath: '/other',
                targetDirectoryPath: '/data/sub',
                jobRuns: [],
                targetPath: {
                    volumePath: '/data/vol',
                    fileServer: { config: { configName: 'data-srv' } },
                },
                sourcePath: {
                    volumePath: '/other/vol',
                    fileServer: { config: { configName: 'other-srv' } },
                },
            };
            mockJobConfigRepository.find.mockResolvedValueOnce([]).mockResolvedValueOnce([mockOverlapJob]).mockResolvedValueOnce([]);
            const result = await service.checkMigrationConflicts(data);
            expect(result).toHaveLength(1);
            expect(result[0].conflictType).toBe('destination');
        });

        it('should treat export-level (null/empty) directory as overlapping with any dir', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                        // no sourceDirectoryPath / destinationDirectoryPath = export-level
                    },
                ],
            };
            const mockJobWithDirs = {
                id: 'job-export',
                status: JobStatus.Active,
                jobType: JobType.MIGRATE,
                sourcePathId: 'dest-1',
                targetPathId: 'source-1',
                sourceDirectoryPath: '/a',
                targetDirectoryPath: '/b',
                jobRuns: [],
                targetPath: {
                    volumePath: '/t',
                    fileServer: { config: { configName: 't-srv' } },
                },
                sourcePath: {
                    volumePath: '/s',
                    fileServer: { config: { configName: 's-srv' } },
                },
            };
            mockJobConfigRepository.find.mockResolvedValueOnce([mockJobWithDirs]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
            const result = await service.checkMigrationConflicts(data);
            expect(result).toHaveLength(1);
            expect(result[0].conflictType).toBe('circular');
        });

        it('should treat paths with trailing slashes as same directory for overlap', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                        sourceDirectoryPath: '/data/',
                        destinationDirectoryPath: '/dest',
                    },
                ],
            };
            const mockJob = {
                id: 'job-slash',
                status: JobStatus.Active,
                jobType: JobType.MIGRATE,
                sourcePathId: 'dest-1',
                targetPathId: 'source-1',
                sourceDirectoryPath: '/x',
                targetDirectoryPath: '/data', // same as /data/ after trim
                jobRuns: [],
                targetPath: {
                    volumePath: '/t',
                    fileServer: { config: { configName: 't-srv' } },
                },
                sourcePath: {
                    volumePath: '/s',
                    fileServer: { config: { configName: 's-srv' } },
                },
            };
            mockJobConfigRepository.find.mockResolvedValueOnce([mockJob]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
            const result = await service.checkMigrationConflicts(data);
            expect(result).toHaveLength(1);
            expect(result[0].conflictType).toBe('circular');
        });

        it('should not double-count job that is both circular and destination conflict', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                        sourceDirectoryPath: '/data',
                        destinationDirectoryPath: '/dest',
                    },
                ],
            };
            const mockSameJob = {
                id: 'job-same',
                status: JobStatus.Active,
                jobType: JobType.MIGRATE,
                sourcePathId: 'dest-1',
                targetPathId: 'source-1',
                sourceDirectoryPath: '/dest',
                targetDirectoryPath: '/data',
                jobRuns: [],
                targetPath: {
                    volumePath: '/dest/vol',
                    fileServer: { config: { configName: 'd-srv' } },
                },
                sourcePath: {
                    volumePath: '/data/vol',
                    fileServer: { config: { configName: 's-srv' } },
                },
            };
            mockJobConfigRepository.find.mockResolvedValueOnce([mockSameJob]).mockResolvedValueOnce([mockSameJob]).mockResolvedValueOnce([]);
            const result = await service.checkMigrationConflicts(data);
            expect(result).toHaveLength(1);
        });
    });

    describe('Directory-level conflict detection methods', () => {
        describe('trimTrailingSlashes', () => {
            it('should remove single trailing slash', () => {
                const result = (service as any).trimTrailingSlashes('/path/to/dir/');
                expect(result).toBe('/path/to/dir');
            });

            it('should remove multiple trailing slashes', () => {
                const result = (service as any).trimTrailingSlashes('/path/to/dir///');
                expect(result).toBe('/path/to/dir');
            });

            it('should not modify path without trailing slash', () => {
                const result = (service as any).trimTrailingSlashes('/path/to/dir');
                expect(result).toBe('/path/to/dir');
            });

            it('should handle empty string', () => {
                const result = (service as any).trimTrailingSlashes('');
                expect(result).toBe('');
            });

            it('should handle single slash', () => {
                const result = (service as any).trimTrailingSlashes('/');
                expect(result).toBe('');
            });

            it('should handle multiple slashes', () => {
                const result = (service as any).trimTrailingSlashes('///');
                expect(result).toBe('');
            });
        });

        describe('hasDirectoryOverlap', () => {
            it('should return true when either directory is null/undefined (export-level job)', () => {
                expect((service as any).hasDirectoryOverlap(null, '/some/path')).toBe(true);
                expect((service as any).hasDirectoryOverlap('/some/path', null)).toBe(true);
                expect((service as any).hasDirectoryOverlap(undefined, '/some/path')).toBe(true);
                expect((service as any).hasDirectoryOverlap('/some/path', undefined)).toBe(true);
                expect((service as any).hasDirectoryOverlap(null, null)).toBe(true);
                expect((service as any).hasDirectoryOverlap(undefined, undefined)).toBe(true);
            });

            it('should return true when directories are exactly the same', () => {
                expect((service as any).hasDirectoryOverlap('/path/to/dir', '/path/to/dir')).toBe(true);
            });

            it('should return true when directories are the same after normalization', () => {
                expect((service as any).hasDirectoryOverlap('/path/to/dir/', '/path/to/dir')).toBe(true);
                expect((service as any).hasDirectoryOverlap('/path/to/dir', '/path/to/dir/')).toBe(true);
                expect((service as any).hasDirectoryOverlap('/path/to/dir///', '/path/to/dir')).toBe(true);
            });

            it('should return true when one directory is parent of another', () => {
                expect((service as any).hasDirectoryOverlap('/parent', '/parent/child')).toBe(true);
                expect((service as any).hasDirectoryOverlap('/parent/child', '/parent')).toBe(true);
                expect((service as any).hasDirectoryOverlap('/grandparent/parent', '/grandparent/parent/child/grandchild')).toBe(true);
            });

            it('should return true when one directory is parent of another with trailing slashes', () => {
                expect((service as any).hasDirectoryOverlap('/parent/', '/parent/child')).toBe(true);
                expect((service as any).hasDirectoryOverlap('/parent', '/parent/child/')).toBe(true);
                expect((service as any).hasDirectoryOverlap('/parent/', '/parent/child/')).toBe(true);
            });

            it('should return false when directories are siblings', () => {
                expect((service as any).hasDirectoryOverlap('/parent/child1', '/parent/child2')).toBe(false);
                expect((service as any).hasDirectoryOverlap('/dir1', '/dir2')).toBe(false);
            });

            it('should return false when directories have similar names but are not related', () => {
                expect((service as any).hasDirectoryOverlap('/parent', '/parent-similar')).toBe(false);
                expect((service as any).hasDirectoryOverlap('/parent-similar', '/parent')).toBe(false);
                expect((service as any).hasDirectoryOverlap('/data', '/database')).toBe(false);
            });

            it('should handle complex nested paths correctly', () => {
                expect((service as any).hasDirectoryOverlap('/a/b/c', '/a/b/c/d/e/f')).toBe(true);
                expect((service as any).hasDirectoryOverlap('/a/b/c/d/e/f', '/a/b/c')).toBe(true);
                expect((service as any).hasDirectoryOverlap('/a/b/c', '/a/b/d')).toBe(false);
            });
        });

        describe('isSameDirectory', () => {
            it('should return true for identical paths', () => {
                expect((service as any).isSameDirectory('/path/to/dir', '/path/to/dir')).toBe(true);
            });

            it('should return true for paths that are the same after normalization', () => {
                expect((service as any).isSameDirectory('/path/to/dir/', '/path/to/dir')).toBe(true);
                expect((service as any).isSameDirectory('/path/to/dir', '/path/to/dir/')).toBe(true);
                expect((service as any).isSameDirectory('/path/to/dir///', '/path/to/dir')).toBe(true);
                expect((service as any).isSameDirectory('/path/to/dir/', '/path/to/dir///')).toBe(true);
            });

            it('should return true when both are null/undefined', () => {
                expect((service as any).isSameDirectory(null, null)).toBe(true);
                expect((service as any).isSameDirectory(undefined, undefined)).toBe(true);
                expect((service as any).isSameDirectory(null, undefined)).toBe(true);
                expect((service as any).isSameDirectory(undefined, null)).toBe(true);
            });

            it('should return true when both are empty after normalization', () => {
                expect((service as any).isSameDirectory('', '')).toBe(true);
                expect((service as any).isSameDirectory('/', '/')).toBe(true);
                expect((service as any).isSameDirectory('///', '')).toBe(true);
                expect((service as any).isSameDirectory('', '///')).toBe(true);
            });

            it('should return false for different paths', () => {
                expect((service as any).isSameDirectory('/path/to/dir1', '/path/to/dir2')).toBe(false);
                expect((service as any).isSameDirectory('/parent/child', '/parent')).toBe(false);
                expect((service as any).isSameDirectory('/parent', '/parent/child')).toBe(false);
            });

            it('should return false when one is null and other is a path', () => {
                expect((service as any).isSameDirectory(null, '/some/path')).toBe(false);
                expect((service as any).isSameDirectory('/some/path', null)).toBe(false);
                expect((service as any).isSameDirectory(undefined, '/some/path')).toBe(false);
                expect((service as any).isSameDirectory('/some/path', undefined)).toBe(false);
            });

            it('should handle edge cases with similar but different paths', () => {
                expect((service as any).isSameDirectory('/parent', '/parent-similar')).toBe(false);
                expect((service as any).isSameDirectory('/data', '/database')).toBe(false);
                expect((service as any).isSameDirectory('/path/sub', '/path/sub-dir')).toBe(false);
            });
        });
    });
});
