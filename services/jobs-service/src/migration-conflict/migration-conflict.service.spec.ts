import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MigrationConflictService } from './migration-conflict.service';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobRunEntity } from '../entities/jobrun.entity';
import { JobRunStatus, JobStatus, JobType } from '../constants/enums';
import { MigrationConflictCheckData } from './types';

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
        it('should return empty array when no migrate configs provided', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [],
            };

            const result = await service.checkMigrationConflicts(data);

            expect(result).toEqual([]);
            expect(mockJobConfigRepository.find).not.toHaveBeenCalled();
        });

        it('should return empty array when no circular dependencies found', async () => {
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
                    jobType: expect.any(Object), // In() matcher
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

        it('should detect circular dependency when conflicting jobs exist with active job runs', async () => {
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

            const mockConflictingJob = {
                id: 'job-1',
                status: JobStatus.Active,
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

            // First call returns the traditional conflicting job
            // Second call returns empty array (no destination path conflicts)
            mockJobConfigRepository.find.mockResolvedValueOnce([mockConflictingJob])
                .mockResolvedValueOnce([]); // No destination path conflicts
            mockJobRunRepository.find.mockResolvedValue([
                { id: 'run-1', status: JobRunStatus.Running },
            ]);

            const result = await service.checkMigrationConflicts(data);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                status: 'ACTIVE',
                jobId: 'job-1',
                jobRunIds: ['run-1'],
                sourcePathId: '/target/path',
                targetPathId: '/source/path',
                sourceServerId: 'source-server',
                targetServerId: 'target-server',
            });
        });

        it('should not detect circular dependency when conflicting jobs exist but no active job runs', async () => {
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

            // First call returns the conflicting job, second call returns empty array
            mockJobConfigRepository.find.mockResolvedValueOnce([mockConflictingJob])
                .mockResolvedValueOnce([]); // No destination path conflicts
            mockJobRunRepository.find.mockResolvedValue([]); // No active job runs

            const result = await service.checkMigrationConflicts(data);

            expect(result).toEqual([]);
        });

        it('should handle multiple migrate configurations', async () => {
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
            expect(mockJobConfigRepository.find).toHaveBeenCalledTimes(4); // 2 configs * 2 queries each (conflicting + destination path conflicts)
        });
        
        it('should detect circular dependency when destination path already has an active job running', async () => {
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

            const mockDestinationPathConflictingJob = {
                id: 'job-2',
                status: JobStatus.Active,
                jobRuns: mockJobRuns,
                targetPath: {
                    volumePath: 'dest-1', // Same as our destination path
                    fileServer: { config: { configName: 'dest-server' } },
                },
                sourcePath: {
                    volumePath: '/some/other/source',
                    fileServer: { config: { configName: 'other-source-server' } },
                },
            };

            // First call for conflicting jobs (should return empty)
            // Second call for destination path conflicts (should return the conflicting job)
            mockJobConfigRepository.find.mockResolvedValueOnce([]) // No traditional circular dependencies
                .mockResolvedValueOnce([mockDestinationPathConflictingJob]); // Destination path conflict

            mockJobRunRepository.find.mockResolvedValue([
                { id: 'run-1', status: JobRunStatus.Running },
            ]);

            const result = await service.checkMigrationConflicts(data);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                status: 'ACTIVE',
                jobId: 'job-2',
                jobRunIds: ['run-1'],
                sourcePathId: 'source-1', // Our source path
                targetPathId: 'dest-1', // Conflicting destination path
                sourceServerId: '',
                targetServerId: 'dest-server',
            });

            // Verify the correct queries were made
            expect(mockJobConfigRepository.find).toHaveBeenCalledTimes(2);
            
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

            // Second call: destination path conflict check
            expect(mockJobConfigRepository.find).toHaveBeenNthCalledWith(2, {
                where: {
                    jobType: expect.any(Object),
                    status: JobStatus.Active,
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

        it('should throw error when repository operation fails', async () => {
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
        it('should call checkMigrationConflicts method', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [],
            };

            const spy = jest.spyOn(service, 'checkMigrationConflicts').mockResolvedValue([]);

            const result = await service.verifyMigrationConflicts(data);

            expect(spy).toHaveBeenCalledWith(data);
            expect(result).toEqual([]);
        });
    });

    describe('hasMigrationConflicts', () => {
        it('should return true when circular dependencies exist', async () => {
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
                jobRunIds: ['run-1'],
                sourcePathId: '/source/path',
                targetPathId: '/target/path',
                sourceServerId: 'source-server',
                targetServerId: 'target-server',
            };

            jest.spyOn(service, 'checkMigrationConflicts').mockResolvedValue([mockDependency]);

            const result = await service.hasMigrationConflicts(data);

            expect(result).toBe(true);
        });

        it('should return false when no circular dependencies exist', async () => {
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
        it('should format input and call checkMigrationConflicts', async () => {
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

    describe('getActiveJobRunDependencies (private method testing through public methods)', () => {
        it('should handle jobs with no job runs', async () => {
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

            mockJobConfigRepository.find.mockResolvedValue([mockConflictingJob]);

            const result = await service.checkMigrationConflicts(data);

            expect(result).toEqual([]);
            expect(mockJobRunRepository.find).not.toHaveBeenCalled();
        });

        it('should filter only active job run statuses', async () => {
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

            mockJobConfigRepository.find.mockResolvedValue([mockConflictingJob]);
            mockJobRunRepository.find.mockResolvedValue([
                { id: 'run-1', status: JobRunStatus.Running },
                { id: 'run-3', status: JobRunStatus.Pending },
            ]);

            const result = await service.checkMigrationConflicts(data);

            expect(mockJobRunRepository.find).toHaveBeenCalledWith({
                where: {
                    id: expect.any(Object), // In() matcher for job run IDs
                    status: expect.any(Object), // In() matcher for active statuses
                },
            });

            expect(result[0].jobRunIds).toEqual(['run-1', 'run-3']);
        });
    });

    describe('Edge cases and error scenarios', () => {
        it('should handle empty destination path arrays', async () => {
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

        it('should handle multiple circular dependencies in a single config', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                    },
                ],
            };

            const mockConflictingJobs = [
                {
                    id: 'job-1',
                    status: JobStatus.Active,
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

            // First call returns conflicting jobs, second call returns empty array (no destination path conflicts)
            mockJobConfigRepository.find.mockResolvedValueOnce(mockConflictingJobs)
                .mockResolvedValueOnce([]); // No destination path conflicts
            mockJobRunRepository.find
                .mockResolvedValueOnce([{ id: 'run-1', status: JobRunStatus.Running }])
                .mockResolvedValueOnce([{ id: 'run-2', status: JobRunStatus.Pending }]);

            const result = await service.checkMigrationConflicts(data);

            expect(result).toHaveLength(2);
            expect(result[0].jobId).toBe('job-1');
            expect(result[1].jobId).toBe('job-2');
        });

        it('should detect both traditional circular dependency and destination path conflict', async () => {
            const data: MigrationConflictCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1', 'dest-2'],
                    },
                ],
            };

            const mockTraditionalConflictingJob = {
                id: 'job-traditional',
                status: JobStatus.Active,
                jobRuns: [{ id: 'run-traditional', status: JobRunStatus.Running }],
                targetPath: {
                    volumePath: '/target/traditional',
                    fileServer: { config: { configName: 'target-traditional-server' } },
                },
                sourcePath: {
                    volumePath: '/source/traditional',
                    fileServer: { config: { configName: 'source-traditional-server' } },
                },
            };

            const mockDestinationConflictingJob = {
                id: 'job-destination',
                status: JobStatus.Active,
                jobRuns: [{ id: 'run-destination', status: JobRunStatus.Pending }],
                targetPath: {
                    volumePath: 'dest-2', // Conflicts with our destination
                    fileServer: { config: { configName: 'dest-conflict-server' } },
                },
                sourcePath: {
                    volumePath: '/some/other/source',
                    fileServer: { config: { configName: 'other-source-server' } },
                },
            };

            // First call: traditional circular dependency check
            // Second call: destination path conflict check
            mockJobConfigRepository.find.mockResolvedValueOnce([mockTraditionalConflictingJob])
                .mockResolvedValueOnce([mockDestinationConflictingJob]);
            
            mockJobRunRepository.find
                .mockResolvedValueOnce([{ id: 'run-traditional', status: JobRunStatus.Running }])
                .mockResolvedValueOnce([{ id: 'run-destination', status: JobRunStatus.Pending }]);

            const result = await service.checkMigrationConflicts(data);

            expect(result).toHaveLength(2);
            
            // First result should be the traditional circular dependency
            expect(result[0]).toEqual({
                status: 'ACTIVE',
                jobId: 'job-traditional',
                jobRunIds: ['run-traditional'],
                sourcePathId: '/target/traditional',
                targetPathId: '/source/traditional',
                sourceServerId: 'source-traditional-server',
                targetServerId: 'target-traditional-server',
            });

            // Second result should be the destination path conflict
            expect(result[1]).toEqual({
                status: 'ACTIVE',
                jobId: 'job-destination',
                jobRunIds: ['run-destination'],
                sourcePathId: 'source-1',
                targetPathId: 'dest-2',
                sourceServerId: '',
                targetServerId: 'dest-conflict-server',
            });
        });
    });
});
