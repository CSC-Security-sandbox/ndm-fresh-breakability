import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ProjectJobConfigMappingActivity } from './project-jobconfig-mapping.activity';

describe('ProjectJobConfigMappingActivity', () => {
    let activity: ProjectJobConfigMappingActivity;
    let mockLogger: jest.Mocked<Logger>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ProjectJobConfigMappingActivity,
            ],
        }).compile();

        activity = module.get<ProjectJobConfigMappingActivity>(ProjectJobConfigMappingActivity);

        // Mock logger if needed (though not directly used in this class)
        mockLogger = {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            verbose: jest.fn(),
        } as any;

        // Reset all mocks
        jest.clearAllMocks();
    });

    describe('getJobConfigIdsByProjectIds', () => {
        it('should extract project IDs from projectWorkerMap when all entries have projectId', async () => {
            const request = {
                traceId: 'trace-123',
                payload: {
                    projectWorkerMap: [
                        { projectId: 'project-1', workerId: 'worker-1' },
                        { projectId: 'project-2', workerId: 'worker-2' },
                        { projectId: 'project-3', workerId: 'worker-3' },
                    ],
                },
            };

            const result = await activity.getJobConfigIdsByProjectIds(request);

            expect(result).toEqual(['project-1', 'project-2', 'project-3']);
        });

        it('should filter out falsy values from projectWorkerMap', async () => {
            const request = {
                traceId: 'trace-456',
                payload: {
                    projectWorkerMap: [
                        { projectId: 'project-1', workerId: 'worker-1' },
                        { projectId: null, workerId: 'worker-2' },
                        { projectId: 'project-3', workerId: 'worker-3' },
                        { projectId: undefined, workerId: 'worker-4' },
                        { projectId: '', workerId: 'worker-5' },
                        { projectId: 'project-6', workerId: 'worker-6' },
                    ],
                },
            };

            const result = await activity.getJobConfigIdsByProjectIds(request);

            expect(result).toEqual(['project-1', 'project-3', 'project-6']);
        });

        it('should return empty array when projectWorkerMap is empty', async () => {
            const request = {
                traceId: 'trace-empty',
                payload: {
                    projectWorkerMap: [],
                },
            };

            const result = await activity.getJobConfigIdsByProjectIds(request);

            expect(result).toEqual([]);
        });

        it('should handle projectWorkerMap with no valid projectIds', async () => {
            const request = {
                traceId: 'trace-invalid',
                payload: {
                    projectWorkerMap: [
                        { projectId: null, workerId: 'worker-1' },
                        { projectId: undefined, workerId: 'worker-2' },
                        { projectId: '', workerId: 'worker-3' },
                        { projectId: false, workerId: 'worker-4' },
                        { projectId: 0, workerId: 'worker-5' },
                    ],
                },
            };

            const result = await activity.getJobConfigIdsByProjectIds(request);

            expect(result).toEqual([]);
        });

        it('should handle single project in projectWorkerMap', async () => {
            const request = {
                traceId: 'trace-single',
                payload: {
                    projectWorkerMap: [
                        { projectId: 'single-project', workerId: 'worker-1' },
                    ],
                },
            };

            const result = await activity.getJobConfigIdsByProjectIds(request);

            expect(result).toEqual(['single-project']);
        });

        it('should handle projectWorkerMap with duplicate projectIds', async () => {
            const request = {
                traceId: 'trace-duplicates',
                payload: {
                    projectWorkerMap: [
                        { projectId: 'project-1', workerId: 'worker-1' },
                        { projectId: 'project-2', workerId: 'worker-2' },
                        { projectId: 'project-1', workerId: 'worker-3' },
                        { projectId: 'project-3', workerId: 'worker-4' },
                        { projectId: 'project-2', workerId: 'worker-5' },
                    ],
                },
            };

            const result = await activity.getJobConfigIdsByProjectIds(request);

            expect(result).toEqual(['project-1', 'project-2', 'project-1', 'project-3', 'project-2']);
        });

        it('should handle projectWorkerMap with mixed data types', async () => {
            const request = {
                traceId: 'trace-mixed',
                payload: {
                    projectWorkerMap: [
                        { projectId: 'string-project', workerId: 'worker-1' },
                        { projectId: 123, workerId: 'worker-2' },
                        { projectId: true, workerId: 'worker-3' },
                        { projectId: 'another-string', workerId: 'worker-4' },
                        { projectId: null, workerId: 'worker-5' },
                    ],
                },
            };

            const result = await activity.getJobConfigIdsByProjectIds(request);

            expect(result).toEqual(['string-project', 123, true, 'another-string']);
        });

        it('should handle projectWorkerMap entries without projectId property', async () => {
            const request = {
                traceId: 'trace-missing-property',
                payload: {
                    projectWorkerMap: [
                        { projectId: 'project-1', workerId: 'worker-1' },
                        { workerId: 'worker-2' }, // Missing projectId
                        { projectId: 'project-3', workerId: 'worker-3' },
                        { someOtherProperty: 'value', workerId: 'worker-4' }, // Missing projectId
                    ],
                },
            };

            const result = await activity.getJobConfigIdsByProjectIds(request);

            expect(result).toEqual(['project-1', 'project-3']);
        });

        it('should handle large projectWorkerMap arrays', async () => {
            const largeProjectWorkerMap = Array.from({ length: 1000 }, (_, index) => ({
                projectId: `project-${index}`,
                workerId: `worker-${index}`,
            }));

            const request = {
                traceId: 'trace-large',
                payload: {
                    projectWorkerMap: largeProjectWorkerMap,
                },
            };

            const result = await activity.getJobConfigIdsByProjectIds(request);

            expect(result).toHaveLength(1000);
            expect(result[0]).toBe('project-0');
            expect(result[999]).toBe('project-999');
        });

        it('should handle projectWorkerMap with special characters in projectIds', async () => {
            const request = {
                traceId: 'trace-special-chars',
                payload: {
                    projectWorkerMap: [
                        { projectId: 'project-with-dashes', workerId: 'worker-1' },
                        { projectId: 'project_with_underscores', workerId: 'worker-2' },
                        { projectId: 'project.with.dots', workerId: 'worker-3' },
                        { projectId: 'project@with@symbols', workerId: 'worker-4' },
                        { projectId: 'project with spaces', workerId: 'worker-5' },
                    ],
                },
            };

            const result = await activity.getJobConfigIdsByProjectIds(request);

            expect(result).toEqual([
                'project-with-dashes',
                'project_with_underscores',
                'project.with.dots',
                'project@with@symbols',
                'project with spaces',
            ]);
        });

        it('should handle undefined payload', async () => {
            const request = {
                traceId: 'trace-undefined-payload',
                payload: undefined,
            };

            await expect(activity.getJobConfigIdsByProjectIds(request))
                .rejects.toThrow();
        });

        it('should handle null payload', async () => {
            const request = {
                traceId: 'trace-null-payload',
                payload: null,
            };

            await expect(activity.getJobConfigIdsByProjectIds(request))
                .rejects.toThrow();
        });

        it('should handle payload without projectWorkerMap property', async () => {
            const request = {
                traceId: 'trace-missing-property',
                payload: {
                    someOtherProperty: 'value',
                },
            };

            await expect(activity.getJobConfigIdsByProjectIds(request))
                .rejects.toThrow();
        });

        it('should handle null projectWorkerMap', async () => {
            const request = {
                traceId: 'trace-null-map',
                payload: {
                    projectWorkerMap: null,
                },
            };

            await expect(activity.getJobConfigIdsByProjectIds(request))
                .rejects.toThrow();
        });

        it('should handle undefined projectWorkerMap', async () => {
            const request = {
                traceId: 'trace-undefined-map',
                payload: {
                    projectWorkerMap: undefined,
                },
            };

            await expect(activity.getJobConfigIdsByProjectIds(request))
                .rejects.toThrow();
        });

        it('should handle non-array projectWorkerMap', async () => {
            const request = {
                traceId: 'trace-non-array',
                payload: {
                    projectWorkerMap: 'not an array',
                },
            };

            await expect(activity.getJobConfigIdsByProjectIds(request))
                .rejects.toThrow();
        });

        it('should process async operation correctly', async () => {
            const request = {
                traceId: 'trace-async',
                payload: {
                    projectWorkerMap: [
                        { projectId: 'async-project-1', workerId: 'worker-1' },
                        { projectId: 'async-project-2', workerId: 'worker-2' },
                    ],
                },
            };

            const startTime = Date.now();
            const result = await activity.getJobConfigIdsByProjectIds(request);
            const endTime = Date.now();

            expect(result).toEqual(['async-project-1', 'async-project-2']);
            // Should complete very quickly since it's just array processing
            expect(endTime - startTime).toBeLessThan(100);
        });

        it('should maintain order of projectIds as they appear in projectWorkerMap', async () => {
            const request = {
                traceId: 'trace-order',
                payload: {
                    projectWorkerMap: [
                        { projectId: 'third', workerId: 'worker-1' },
                        { projectId: 'first', workerId: 'worker-2' },
                        { projectId: 'second', workerId: 'worker-3' },
                        { projectId: 'fourth', workerId: 'worker-4' },
                    ],
                },
            };

            const result = await activity.getJobConfigIdsByProjectIds(request);

            expect(result).toEqual(['third', 'first', 'second', 'fourth']);
        });

        it('should handle projectWorkerMap with complex nested objects', async () => {
            const request = {
                traceId: 'trace-complex',
                payload: {
                    projectWorkerMap: [
                        {
                            projectId: 'complex-project-1',
                            workerId: 'worker-1',
                            metadata: { type: 'production', region: 'us-east' }
                        },
                        {
                            projectId: 'complex-project-2',
                            workerId: 'worker-2',
                            config: { timeout: 5000, retries: 3 }
                        },
                    ],
                },
            };

            const result = await activity.getJobConfigIdsByProjectIds(request);

            expect(result).toEqual(['complex-project-1', 'complex-project-2']);
        });
    });

    describe('Constructor and Initialization', () => {
        it('should be properly instantiated', () => {
            expect(activity).toBeDefined();
            expect(activity).toBeInstanceOf(ProjectJobConfigMappingActivity);
        });

        it('should have getJobConfigIdsByProjectIds method', () => {
            expect(typeof activity.getJobConfigIdsByProjectIds).toBe('function');
        });
    });
});
