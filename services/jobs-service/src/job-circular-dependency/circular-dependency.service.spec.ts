import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CircularDependencyService } from './circular-dependency.service';
import { JobConfigEntity } from '../entities/jobconfig.entity';
import { JobRunEntity } from '../entities/jobrun.entity';
import { JobRunStatus, JobStatus, JobType } from '../constants/enums';
import { CircularDependencyCheckData } from './types';

describe('CircularDependencyService', () => {
    let service: CircularDependencyService;
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
                CircularDependencyService,
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

        service = module.get<CircularDependencyService>(CircularDependencyService);
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

    describe('checkCircularDependency', () => {
        it('should return empty array when no migrate configs provided', async () => {
            const data: CircularDependencyCheckData = {
                migrateConfigs: [],
            };

            const result = await service.checkCircularDependency(data);

            expect(result).toEqual([]);
            expect(mockJobConfigRepository.find).not.toHaveBeenCalled();
        });

        it('should return empty array when no circular dependencies found', async () => {
            const data: CircularDependencyCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                    },
                ],
            };

            mockJobConfigRepository.find.mockResolvedValue([]);

            const result = await service.checkCircularDependency(data);

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
            const data: CircularDependencyCheckData = {
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

            mockJobConfigRepository.find.mockResolvedValue([mockConflictingJob]);
            mockJobRunRepository.find.mockResolvedValue([
                { id: 'run-1', status: JobRunStatus.Running },
            ]);

            const result = await service.checkCircularDependency(data);

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
            const data: CircularDependencyCheckData = {
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

            mockJobConfigRepository.find.mockResolvedValue([mockConflictingJob]);
            mockJobRunRepository.find.mockResolvedValue([]); // No active job runs

            const result = await service.checkCircularDependency(data);

            expect(result).toEqual([]);
        });

        it('should handle multiple migrate configurations', async () => {
            const data: CircularDependencyCheckData = {
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

            const result = await service.checkCircularDependency(data);

            expect(result).toEqual([]);
            expect(mockJobConfigRepository.find).toHaveBeenCalledTimes(2);
        });

        it('should throw error when repository operation fails', async () => {
            const data: CircularDependencyCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                    },
                ],
            };

            mockJobConfigRepository.find.mockRejectedValue(new Error('Database error'));

            try {
                await service.checkCircularDependency(data);
                expect(true).toBe(false); // Should not reach here
            } catch (error) {
                expect(error.message).toBe('Failed to check circular dependencies: Error: Database error');
            }
        });
    });

    describe('verifyCircularTaskDependency', () => {
        it('should call checkCircularDependency method', async () => {
            const data: CircularDependencyCheckData = {
                migrateConfigs: [],
            };

            const spy = jest.spyOn(service, 'checkCircularDependency').mockResolvedValue([]);

            const result = await service.verifyCircularTaskDependency(data);

            expect(spy).toHaveBeenCalledWith(data);
            expect(result).toEqual([]);
        });
    });

    describe('hasCircularDependencies', () => {
        it('should return true when circular dependencies exist', async () => {
            const data: CircularDependencyCheckData = {
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

            jest.spyOn(service, 'checkCircularDependency').mockResolvedValue([mockDependency]);

            const result = await service.hasCircularDependencies(data);

            expect(result).toBe(true);
        });

        it('should return false when no circular dependencies exist', async () => {
            const data: CircularDependencyCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1'],
                    },
                ],
            };

            jest.spyOn(service, 'checkCircularDependency').mockResolvedValue([]);

            const result = await service.hasCircularDependencies(data);

            expect(result).toBe(false);
        });
    });

    describe('getCircularDependencyDetails', () => {
        it('should format input and call checkCircularDependency', async () => {
            const sourcePathId = 'source-1';
            const destinationPathIds = ['dest-1', 'dest-2'];

            const expectedData: CircularDependencyCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: ['dest-1', 'dest-2'],
                    },
                ],
            };

            const spy = jest.spyOn(service, 'checkCircularDependency').mockResolvedValue([]);

            const result = await service.getCircularDependencyDetails(
                sourcePathId,
                destinationPathIds,
            );

            expect(spy).toHaveBeenCalledWith(expectedData);
            expect(result).toEqual([]);
        });
    });

    describe('getActiveJobRunDependencies (private method testing through public methods)', () => {
        it('should handle jobs with no job runs', async () => {
            const data: CircularDependencyCheckData = {
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

            const result = await service.checkCircularDependency(data);

            expect(result).toEqual([]);
            expect(mockJobRunRepository.find).not.toHaveBeenCalled();
        });

        it('should filter only active job run statuses', async () => {
            const data: CircularDependencyCheckData = {
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

            const result = await service.checkCircularDependency(data);

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
            const data: CircularDependencyCheckData = {
                migrateConfigs: [
                    {
                        sourcePathId: 'source-1',
                        destinationPathId: [],
                    },
                ],
            };

            mockJobConfigRepository.find.mockResolvedValue([]);

            const result = await service.checkCircularDependency(data);

            expect(result).toEqual([]);
        });

        it('should handle multiple circular dependencies in a single config', async () => {
            const data: CircularDependencyCheckData = {
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

            mockJobConfigRepository.find.mockResolvedValue(mockConflictingJobs);
            mockJobRunRepository.find
                .mockResolvedValueOnce([{ id: 'run-1', status: JobRunStatus.Running }])
                .mockResolvedValueOnce([{ id: 'run-2', status: JobRunStatus.Pending }]);

            const result = await service.checkCircularDependency(data);

            expect(result).toHaveLength(2);
            expect(result[0].jobId).toBe('job-1');
            expect(result[1].jobId).toBe('job-2');
        });
    });
});
