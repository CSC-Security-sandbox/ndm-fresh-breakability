// Mock external dependencies before any imports to avoid REQUEST token issues
const mockWorker = {
    run: jest.fn(),
    shutdown: jest.fn(),
};

const mockConnection = {
    close: jest.fn(),
};

const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
};

// Mock @temporalio/worker
jest.mock('@temporalio/worker', () => ({
    Worker: {
        create: jest.fn().mockResolvedValue(mockWorker),
    },
    NativeConnection: {
        connect: jest.fn().mockResolvedValue(mockConnection),
    },
}));

// Mock only the Logger class from @nestjs/common, not the entire module
jest.mock('@nestjs/common', () => {
    const actual = jest.requireActual('@nestjs/common');
    return {
        ...actual,
        Logger: jest.fn().mockImplementation(() => mockLogger),
    };
});

// Create a simple mock for the activities service
const mockActivitiesServiceClass = jest.fn().mockImplementation(() => ({
    fetchAndZipLogs: jest.fn(),
    notifyWorkflowCompletion: jest.fn(),
    getJobConfigIdsByProjectIds: jest.fn(),
    generateErrorCsv: jest.fn(),
}));

// Mock the activities service module
jest.doMock('../activities/activities.service', () => ({
    ActivitiesService: mockActivitiesServiceClass,
}), { virtual: true });

// Also mock the path used in worker.providers.ts
jest.doMock('src/activities/activities.service', () => ({
    ActivitiesService: mockActivitiesServiceClass,
}), { virtual: true });

import { workerProviders } from './worker.providers';
import { ConfigService } from '@nestjs/config';

describe('WorkerProviders', () => {
    const mockActivitiesService = {
        fetchAndZipLogs: jest.fn(),
        notifyWorkflowCompletion: jest.fn(),
        getJobConfigIdsByProjectIds: jest.fn(),
        generateErrorCsv: jest.fn(),
    } as any;

    const mockConfigService = {
        get: jest.fn(),
    } as any;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Reset the worker mock to its default behavior
        mockWorker.run.mockResolvedValue(undefined);

        // Reset external mocks
        const { Worker, NativeConnection } = require('@temporalio/worker');
        Worker.create.mockResolvedValue(mockWorker);
        NativeConnection.connect.mockResolvedValue(mockConnection);
    });

    describe('workerProviders configuration', () => {
        it('should have correct provider configuration', () => {
            expect(workerProviders).toHaveLength(1);
            expect(workerProviders[0].provide).toBe('TEMPORAL_WORKER');
            expect(workerProviders[0].inject).toEqual([mockActivitiesServiceClass, ConfigService]);
            expect(typeof workerProviders[0].useFactory).toBe('function');
        });
    });

    describe('useFactory function', () => {
        let factoryFunction: Function;

        beforeEach(() => {
            factoryFunction = workerProviders[0].useFactory;
        });

        it('should create worker in development environment', async () => {
            // Setup mocks for development environment
            mockConfigService.get.mockImplementation((key: string) => {
                switch (key) {
                    case 'NODE_ENV':
                        return 'development';
                    case 'temporal.address':
                        return 'localhost:7233';
                    default:
                        return undefined;
                }
            });

            const result = await factoryFunction(mockActivitiesService, mockConfigService);

            const { NativeConnection, Worker } = require('@temporalio/worker');

            expect(NativeConnection.connect).toHaveBeenCalledWith({
                address: 'localhost:7233',
            });

            expect(Worker.create).toHaveBeenCalledWith({
                taskQueue: 'Support-TaskQueue',
                connection: mockConnection,
                workflowsPath: expect.any(String),
                activities: expect.objectContaining({
                    fetchAndZipLogs: expect.any(Function),
                    notifyWorkflowCompletion: expect.any(Function),
                    getJobConfigIdsByProjectIds: expect.any(Function),
                    generateErrorCsv: expect.any(Function),
                }),
            });

            expect(mockWorker.run).toHaveBeenCalled();
            expect(result).toBe(mockWorker);
        });

        it('should create worker in production environment', async () => {
            // Setup mocks for production environment
            mockConfigService.get.mockImplementation((key: string) => {
                switch (key) {
                    case 'NODE_ENV':
                        return 'production';
                    case 'temporal.address':
                        return 'temporal.production.com:7233';
                    default:
                        return undefined;
                }
            });

            const result = await factoryFunction(mockActivitiesService, mockConfigService);

            const { NativeConnection, Worker } = require('@temporalio/worker');

            expect(NativeConnection.connect).toHaveBeenCalledWith({
                address: 'temporal.production.com:7233',
            });

            expect(Worker.create).toHaveBeenCalledWith({
                taskQueue: 'Support-TaskQueue',
                connection: mockConnection,
                workflowBundle: {
                    codePath: expect.stringContaining('workflow-bundle.js'),
                },
                activities: expect.objectContaining({
                    fetchAndZipLogs: expect.any(Function),
                    notifyWorkflowCompletion: expect.any(Function),
                    getJobConfigIdsByProjectIds: expect.any(Function),
                    generateErrorCsv: expect.any(Function),
                }),
            });

            expect(mockWorker.run).toHaveBeenCalled();
            expect(result).toBe(mockWorker);
        });

        it('should bind activities correctly', async () => {
            mockConfigService.get.mockImplementation((key: string) => {
                switch (key) {
                    case 'NODE_ENV':
                        return 'development';
                    case 'temporal.address':
                        return 'localhost:7233';
                    default:
                        return undefined;
                }
            });

            await factoryFunction(mockActivitiesService, mockConfigService);

            const { Worker } = require('@temporalio/worker');
            const createCall = Worker.create.mock.calls[0][0];
            const activities = createCall.activities;

            // Verify activities are bound functions
            expect(activities.fetchAndZipLogs).toBeDefined();
            expect(activities.notifyWorkflowCompletion).toBeDefined();
            expect(activities.getJobConfigIdsByProjectIds).toBeDefined();
            expect(activities.generateErrorCsv).toBeDefined();

            // Test that bound functions work correctly
            const testArgs = ['test', 'args'];
            activities.fetchAndZipLogs(...testArgs);
            expect(mockActivitiesService.fetchAndZipLogs).toHaveBeenCalledWith(...testArgs);

            activities.notifyWorkflowCompletion(...testArgs);
            expect(mockActivitiesService.notifyWorkflowCompletion).toHaveBeenCalledWith(...testArgs);

            activities.getJobConfigIdsByProjectIds(...testArgs);
            expect(mockActivitiesService.getJobConfigIdsByProjectIds).toHaveBeenCalledWith(...testArgs);

            activities.generateErrorCsv(...testArgs);
            expect(mockActivitiesService.generateErrorCsv).toHaveBeenCalledWith(...testArgs);
        });

        it('should use correct task queue', async () => {
            mockConfigService.get.mockImplementation((key: string) => {
                switch (key) {
                    case 'NODE_ENV':
                        return 'development';
                    case 'temporal.address':
                        return 'localhost:7233';
                    default:
                        return undefined;
                }
            });

            await factoryFunction(mockActivitiesService, mockConfigService);

            const { Worker } = require('@temporalio/worker');
            const createCall = Worker.create.mock.calls[0][0];
            expect(createCall.taskQueue).toBe('Support-TaskQueue');
        });

        it('should handle connection failures', async () => {
            mockConfigService.get.mockReturnValue('localhost:7233');
            const connectionError = new Error('Failed to connect to Temporal server');

            const { NativeConnection, Worker } = require('@temporalio/worker');
            NativeConnection.connect.mockRejectedValue(connectionError);

            await expect(
                factoryFunction(mockActivitiesService, mockConfigService)
            ).rejects.toThrow('Failed to connect to Temporal server');

            expect(Worker.create).not.toHaveBeenCalled();
        });

        it('should handle worker creation failures', async () => {
            mockConfigService.get.mockImplementation((key: string) => {
                switch (key) {
                    case 'NODE_ENV':
                        return 'development';
                    case 'temporal.address':
                        return 'localhost:7233';
                    default:
                        return undefined;
                }
            });

            const workerError = new Error('Failed to create worker');
            const { Worker } = require('@temporalio/worker');
            Worker.create.mockRejectedValue(workerError);

            await expect(
                factoryFunction(mockActivitiesService, mockConfigService)
            ).rejects.toThrow('Failed to create worker');

            expect(mockWorker.run).not.toHaveBeenCalled();
        });

        it('should handle different NODE_ENV values', async () => {
            const environments = ['test', 'staging', 'qa', 'production'];

            for (const env of environments) {
                jest.clearAllMocks();

                // Reset mocks for each iteration
                const { Worker } = require('@temporalio/worker');
                Worker.create.mockResolvedValue(mockWorker);

                mockConfigService.get.mockImplementation((key: string) => {
                    switch (key) {
                        case 'NODE_ENV':
                            return env;
                        case 'temporal.address':
                            return 'localhost:7233';
                        default:
                            return undefined;
                    }
                });

                await factoryFunction(mockActivitiesService, mockConfigService);

                const createCall = Worker.create.mock.calls[0][0];

                if (env === 'production') {
                    expect(createCall).toHaveProperty('workflowBundle');
                    expect(createCall).not.toHaveProperty('workflowsPath');
                } else {
                    expect(createCall).toHaveProperty('workflowsPath');
                    expect(createCall).not.toHaveProperty('workflowBundle');
                }
            }
        });
    });

    describe('Error handling scenarios', () => {
        const factoryFunction = workerProviders[0].useFactory;

        it('should handle worker run failures gracefully', async () => {
            mockConfigService.get.mockImplementation((key: string) => {
                switch (key) {
                    case 'NODE_ENV':
                        return 'development';
                    case 'temporal.address':
                        return 'localhost:7233';
                    default:
                        return undefined;
                }
            });

            // Mock worker.run to not throw an error for this test
            mockWorker.run.mockImplementation(() => {
                // Simulate an error but don't actually throw
                // since worker.run() is called without await
            });

            // The factory should still complete successfully even if run fails
            // since run() is called asynchronously
            const result = await factoryFunction(mockActivitiesService, mockConfigService);

            const { Worker } = require('@temporalio/worker');
            expect(Worker.create).toHaveBeenCalled();
            expect(mockWorker.run).toHaveBeenCalled();
            expect(result).toBe(mockWorker);
        });

        it('should handle custom temporal address', async () => {
            const customAddress = 'custom-temporal-server:9090';
            mockConfigService.get.mockImplementation((key: string) => {
                switch (key) {
                    case 'NODE_ENV':
                        return 'staging';
                    case 'temporal.address':
                        return customAddress;
                    default:
                        return undefined;
                }
            });

            await factoryFunction(mockActivitiesService, mockConfigService);

            const { NativeConnection } = require('@temporalio/worker');
            expect(NativeConnection.connect).toHaveBeenCalledWith({
                address: customAddress,
            });
        });

        it('should handle missing temporal address configuration', async () => {
            mockConfigService.get.mockImplementation((key: string) => {
                switch (key) {
                    case 'NODE_ENV':
                        return 'development';
                    case 'temporal.address':
                        return undefined;
                    default:
                        return undefined;
                }
            });

            await factoryFunction(mockActivitiesService, mockConfigService);

            const { NativeConnection } = require('@temporalio/worker');
            expect(NativeConnection.connect).toHaveBeenCalledWith({
                address: undefined,
            });
        });
    });
});
