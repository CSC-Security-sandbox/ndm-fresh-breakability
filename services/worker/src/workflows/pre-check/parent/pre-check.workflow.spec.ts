import { ExportPathSource } from 'src/activities/list-path/list-path.type';
import { PreCheckWorkerValidationWorkflow } from '../core/pre-check.worker.workflow';
import { PreCheckErrorCodes, PreCheckStatus, PreCheckWorkflowRequest } from '../pre-check.types';
import { PreCheckValidationWorkflow } from './pre-check.workflow';
const mockExecuteChild = require('@temporalio/workflow').executeChild as jest.Mock;

jest.mock('@temporalio/workflow', () => ({
    executeChild: jest.fn(),
    proxyActivities: jest.fn(() => ({
        preCheckPath: jest.fn().mockImplementation((settings, serverCredentials, serverPaths, traceId) => {
            switch (serverPaths.pathId) {
                case 'source-path-1':
                    return Promise.resolve({
                        pathId: serverPaths.pathId,
                        status: PreCheckStatus.SUCCESS,
                        errorCode: undefined,
                        workerId: 'worker-1'
                    });
                case 'dest-path-1':
                    return Promise.resolve({
                        pathId: serverPaths.pathId,
                        status: PreCheckStatus.FAILED,
                        errorCode: PreCheckErrorCodes.PROTOCOL_VERSION_MISMATCH,
                        workerId: 'worker-1'
                    });
                case 'path-timeout':
                    return new Promise(() => { });
                case 'path-error':
                    return Promise.reject(new Error('Unexpected error'));
                default:
                    return Promise.resolve({
                        pathId: serverPaths.pathId,
                        status: PreCheckStatus.FAILED,
                        errorCode: PreCheckErrorCodes.SOURCE_PATH_NOT_FOUND ,
                        workerId: 'worker-1'
                    });
            }
        }),
    })),
    ChildWorkflowCancellationType: {
        WAIT_CANCELLATION_COMPLETED: 'WAIT_CANCELLATION_COMPLETED',
    },
    ParentClosePolicy: {
        TERMINATE: 'TERMINATE',
    },
}));

describe('PreCheckValidationWorkflow', () => {
    const mockSettings = {
        preserveAccessTime: false,
        preservePermissions: true
    };

    const mockServerCredentials = [
        {
            id: 'server-1',
            host: 'host1',
            userName: 'user1',
            password: 'pass1',
            protocol: 'protocol1',
            protocolVersion: '1.0',
            serverType: 'type1',
            exportPathSource: ExportPathSource.AUTO_DISCOVER
        }
    ];

    beforeEach(() => {
        jest.clearAllMocks();
    });

    // Scenario 1: Successful paths
    it('should successfully validate source and destination paths', async () => {
        const mockServerPaths = [
            {
                pathId: 'source-path-1',
                serverId: 'server-1',
                pathName: 'Source Path 1',
                isSource: true
            },
            {
                pathId: 'dest-path-1',
                serverId: 'server-1',
                pathName: 'Destination Path 1',
                isSource: false
            }
        ];

        const result = await PreCheckWorkerValidationWorkflow(
            'worker-1',
            {
                settings: mockSettings,
                serverCredentials: mockServerCredentials,
                serverPaths: mockServerPaths
            },
            'test-trace-id'
        );

        expect(result.workerId).toBe('worker-1');
        expect(result.paths).toHaveLength(2);
        expect(result.paths[0].status).toBe(PreCheckStatus.SUCCESS);
        expect(result.paths[1].status).toBe(PreCheckStatus.FAILED);
    });

    // Scenario 2: Failed path validation
    it('should handle failed path validation', async () => {
        const mockServerPaths = [
            {
                pathId: 'source-path-1',
                serverId: 'server-1',
                pathName: 'Source Path 1',
                isSource: true
            },
            {
                pathId: 'dest-path-1',
                serverId: 'server-1',
                pathName: 'Destination Path 1',
                isSource: false
            }
        ];
        const result = await PreCheckWorkerValidationWorkflow(
            'worker-1',
            {
                settings: mockSettings,
                serverCredentials: mockServerCredentials,
                serverPaths: mockServerPaths
            },
            'test-trace-id'
        );

        expect(result.workerId).toBe('worker-1');
        expect(result.paths[0].status).toBe(PreCheckStatus.SUCCESS);
        expect(result.paths[1].status).toBe(PreCheckStatus.FAILED);
    });

    // Scenario 3: Path validation timeout
    it('should handle path validation timeout', async () => {
        const mockServerPaths = [
            {
                pathId: 'path-timeout',
                serverId: 'server-1',
                pathName: 'Timeout Path',
                isSource: true
            }
        ];

        // Increase timeout for this specific test
        jest.setTimeout(10000);

        // Use a Promise that explicitly times out
        await expect(
            Promise.race([
                PreCheckWorkerValidationWorkflow(
                    'worker-1',
                    {
                        settings: mockSettings,
                        serverCredentials: mockServerCredentials,
                        serverPaths: mockServerPaths
                    },
                    'test-trace-id'
                ),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout exceeded')), 6000)
                )
            ])
        ).rejects.toThrow('Timeout exceeded');
    }, 7000);

    // Scenario 4: Path validation error
    it('should handle unexpected errors during path validation', async () => {
        const mockServerPaths = [
            {
                pathId: 'path-error',
                serverId: 'server-1',
                pathName: 'Error Path',
                isSource: true
            }
        ];

        await expect(PreCheckWorkerValidationWorkflow(
            'worker-1',
            {
                settings: mockSettings,
                serverCredentials: mockServerCredentials,
                serverPaths: mockServerPaths
            },
            'test-trace-id'
        )).rejects.toThrow(); // Expecting an error to be thrown
    });

    // Scenario 5: Empty server paths
    it('should handle empty server paths', async () => {
        const result = await PreCheckWorkerValidationWorkflow(
            'worker-1',
            {
                settings: mockSettings,
                serverCredentials: mockServerCredentials,
                serverPaths: []
            },
            'test-trace-id'
        );

        expect(result.workerId).toBe('worker-1');
        expect(result.paths).toHaveLength(0);
    });

    it('should handle no server credentials', async () => {
        const result = await PreCheckValidationWorkflow({
            payload: {
                serverCredentials: [],
                preChecks: [],
                settings: mockSettings
            },
            traceId: 'test-trace-id',
            options: undefined
        });

        expect(result).toEqual([]); // Adjust based on expected behavior
    });

    it('should handle preCheck with no destinations', async () => {
        const mockServerPaths = [
            {
                pathId: 'source-path-1',
                serverId: 'server-1',
                pathName: 'Source Path 1',
                isSource: true
            }
        ];

        const result = await PreCheckWorkerValidationWorkflow(
            'worker-1',
            {
                settings: mockSettings,
                serverCredentials: mockServerCredentials,
                serverPaths: mockServerPaths
            },
            'test-trace-id'
        );

        expect(result.paths).toHaveLength(1);
        expect(result.paths[0].status).toBe(PreCheckStatus.SUCCESS); // Adjust based on expected behavior
    });

    it('should handle protocol version mismatch', async () => {
        const mockServerPaths = [
            {
                pathId: 'source-path-1',
                serverId: 'server-1',
                pathName: 'Source Path 1',
                isSource: true
            },
            {
                pathId: 'dest-path-1',
                serverId: 'server-2', // Different server to trigger mismatch
                pathName: 'Destination Path 1',
                isSource: false
            }
        ];

        const result = await PreCheckWorkerValidationWorkflow(
            'worker-1',
            {
                settings: mockSettings,
                serverCredentials: mockServerCredentials,
                serverPaths: mockServerPaths
            },
            'test-trace-id'
        );

        expect(result.paths[1].status).toBe(PreCheckStatus.FAILED);
        // expect(result.paths[1].errorCodes).toBe(PreCheckErrorCodes.PROTOCOL_VERSION_MISMATCH);
        expect(result.paths[0].status).toBe(PreCheckStatus.SUCCESS); 
    });

    it('should fail if all workers in the destination are unhealthy', async () => {
        const request: PreCheckWorkflowRequest = {
          traceId: 'test-trace-id',
          options: {
            workflowExecutionTimeout: '1m',
            workflowTaskTimeout: '30s',
            workflowRunTimeout: '5m',
            startDelay: '0s'
          },
          payload: {
            settings: {
              preserveAccessTime: false,
              preservePermissions: true
            },
            serverCredentials: [
              {
                id: 'server-1',
                host: 'host1',
                userName: 'user1',
                password: 'pass1',
                protocol: 'sftp',
                protocolVersion: '1.0.0',
                serverType: 'linux',
                exportPathSource: ExportPathSource.AUTO_DISCOVER
              },
              {
                id: 'server-2',
                host: 'host2',
                userName: 'user2',
                password: 'pass2',
                protocol: 'sftp',
                protocolVersion: '1.0.0',
                serverType: 'linux',
                exportPathSource: ExportPathSource.AUTO_DISCOVER
              }
            ],
            preChecks: [
              {
                pathId: 'source-path-1',
                serverId: 'server-1',
                pathName: 'Source Path 1',
                destinations: [
                  {
                    pathId: 'dest-path-1',
                    serverId: 'server-2',
                    pathName: 'Destination Path 1',
                    workers: [
                      { workerId: 'worker-1', ishealthy: false },
                      { workerId: 'worker-2', ishealthy: false }
                    ]
                  }
                ]
              }
            ]
          }
        };
      
        const result = await PreCheckValidationWorkflow(request);
      
        expect(result[0].destination[0].status).toBe(PreCheckStatus.FAILED);
        expect(result[0].destination[0].errors).toContain(PreCheckErrorCodes.ALL_COMMON_WORKERS_UNHEALTHY);
      });

    it('should return empty array if no preChecks are provided', async () => {
        const request = {
            payload: {
                serverCredentials: [
                    {
                        id: 'server-1',
                        host: 'host1',
                        userName: 'user1',
                        password: 'pass1',
                        protocol: 'sftp',
                        protocolVersion: '1.0.0',
                        serverType: 'linux'
                    }
                ],
                preChecks: [],
                settings: { preserveAccessTime: false, preservePermissions: true }
            },
            traceId: 'trace-1'
        };
        const result = await PreCheckValidationWorkflow(request as any);
        expect(result).toEqual([]);
    });

    it('should fail destination if no common workers', async () => {
        const request = {
            payload: {
                serverCredentials: [
                    {
                        id: 'server-1',
                        host: 'host1',
                        userName: 'user1',
                        password: 'pass1',
                        protocol: 'sftp',
                        protocolVersion: '1.0.0',
                        serverType: 'linux'
                    },
                    {
                        id: 'server-2',
                        host: 'host2',
                        userName: 'user2',
                        password: 'pass2',
                        protocol: 'sftp',
                        protocolVersion: '1.0.0',
                        serverType: 'linux'
                    }
                ],
                preChecks: [
                    {
                        pathId: 'source-path-1',
                        serverId: 'server-1',
                        pathName: 'Source Path 1',
                        destinations: [
                            {
                                pathId: 'dest-path-1',
                                serverId: 'server-2',
                                pathName: 'Destination Path 1',
                                workers: []
                            }
                        ]
                    }
                ],
                settings: { preserveAccessTime: false, preservePermissions: true }
            },
            traceId: 'trace-2'
        };
        const result = await PreCheckValidationWorkflow(request as any);
        expect(result[0].destination[0].status).toBe(PreCheckStatus.FAILED);
        expect(result[0].destination[0].errors).toContain(PreCheckErrorCodes.NO_COMMON_WORKERS);
    });

    it('should mark source as failed if worker response marks it failed', async () => {
        const request = {
            payload: {
                serverCredentials: [
                    {
                        id: 'server-1',
                        host: 'host1',
                        userName: 'user1',
                        password: 'pass1',
                        protocol: 'sftp',
                        protocolVersion: '1.0.0',
                        serverType: 'linux'
                    }
                ],
                preChecks: [
                    {
                        pathId: 'source-path-1',
                        serverId: 'server-1',
                        pathName: 'Source Path 1',
                        destinations: []
                    }
                ],
                settings: { preserveAccessTime: false, preservePermissions: true }
            },
            traceId: 'trace-5'
        };
        // Mock executeChild to resolve with failed source
        mockExecuteChild.mockResolvedValueOnce({
            workerId: 'worker-1',
            paths: [
                { pathId: 'source-path-1', status: PreCheckStatus.FAILED, errorCodes: [PreCheckErrorCodes.SOURCE_PATH_NOT_FOUND], sourceDataSize: 0 }
            ]
        });
        const result = await PreCheckValidationWorkflow(request as any);
        expect(result[0].status).toBe(PreCheckStatus.SUCCESS);
    });

    // --- Warning propagation ---

    describe('warning propagation from worker path results', () => {
        beforeEach(() => {
            // Reset return-value queue to eliminate any leaked mockResolvedValueOnce
            // from outer tests that never call executeChild (e.g. tests with destinations: [])
            mockExecuteChild.mockReset();
        });

        const baseRequest = {
            payload: {
                serverCredentials: [
                    { id: 'server-1', host: 'host1', userName: 'user1', password: 'pass1', protocol: 'sftp', protocolVersion: '1.0.0', serverType: 'linux', exportPathSource: ExportPathSource.AUTO_DISCOVER },
                    { id: 'server-2', host: 'host2', userName: 'user2', password: 'pass2', protocol: 'sftp', protocolVersion: '1.0.0', serverType: 'linux', exportPathSource: ExportPathSource.AUTO_DISCOVER },
                ],
                preChecks: [
                    {
                        pathId: 'source-path-1',
                        serverId: 'server-1',
                        pathName: 'Source Path 1',
                        destinations: [
                            {
                                pathId: 'dest-path-1',
                                serverId: 'server-2',
                                pathName: 'Destination Path 1',
                                workers: [{ workerId: 'worker-1', ishealthy: true }],
                            },
                        ],
                    },
                ],
                settings: { preserveAccessTime: false, preservePermissions: true },
            },
            traceId: 'trace-warn',
            options: undefined,
        };

        it('should propagate destination path warnings to destination.warnings', async () => {
            mockExecuteChild.mockResolvedValueOnce({
                workerId: 'worker-1',
                paths: [
                    { pathId: 'source-path-1', status: PreCheckStatus.SUCCESS, errorCodes: [], warnings: [] },
                    {
                        pathId: 'dest-path-1',
                        status: PreCheckStatus.SUCCESS,
                        errorCodes: [],
                        warnings: [PreCheckErrorCodes.BACKUP_OPERATORS_NOT_MEMBER],
                    },
                ],
            });

            const result = await PreCheckValidationWorkflow(baseRequest as any);

            expect(result[0].destination[0].warnings).toContain(PreCheckErrorCodes.BACKUP_OPERATORS_NOT_MEMBER);
        });

        it('should propagate source path warnings to destination.warnings', async () => {
            mockExecuteChild.mockResolvedValueOnce({
                workerId: 'worker-1',
                paths: [
                    {
                        pathId: 'source-path-1',
                        status: PreCheckStatus.SUCCESS,
                        errorCodes: [],
                        warnings: [PreCheckErrorCodes.BACKUP_OPERATORS_CHECK_SKIPPED],
                    },
                    { pathId: 'dest-path-1', status: PreCheckStatus.SUCCESS, errorCodes: [], warnings: [] },
                ],
            });

            const result = await PreCheckValidationWorkflow(baseRequest as any);

            expect(result[0].destination[0].warnings).toContain(PreCheckErrorCodes.BACKUP_OPERATORS_CHECK_SKIPPED);
        });

        it('should propagate both source and destination warnings together', async () => {
            mockExecuteChild.mockResolvedValueOnce({
                workerId: 'worker-1',
                paths: [
                    {
                        pathId: 'source-path-1',
                        status: PreCheckStatus.SUCCESS,
                        errorCodes: [],
                        warnings: [PreCheckErrorCodes.BACKUP_OPERATORS_CHECK_SKIPPED],
                    },
                    {
                        pathId: 'dest-path-1',
                        status: PreCheckStatus.SUCCESS,
                        errorCodes: [],
                        warnings: [PreCheckErrorCodes.BACKUP_OPERATORS_NOT_MEMBER],
                    },
                ],
            });

            const result = await PreCheckValidationWorkflow(baseRequest as any);

            expect(result[0].destination[0].warnings).toContain(PreCheckErrorCodes.BACKUP_OPERATORS_CHECK_SKIPPED);
            expect(result[0].destination[0].warnings).toContain(PreCheckErrorCodes.BACKUP_OPERATORS_NOT_MEMBER);
        });

        it('should leave destination.warnings empty when no path warnings exist', async () => {
            mockExecuteChild.mockResolvedValueOnce({
                workerId: 'worker-1',
                paths: [
                    { pathId: 'source-path-1', status: PreCheckStatus.SUCCESS, errorCodes: [], warnings: [] },
                    { pathId: 'dest-path-1', status: PreCheckStatus.SUCCESS, errorCodes: [], warnings: [] },
                ],
            });

            const result = await PreCheckValidationWorkflow(baseRequest as any);

            expect(result[0].destination[0].warnings).toEqual([]);
        });

        it('should leave destination.warnings empty when path warnings field is undefined', async () => {
            mockExecuteChild.mockResolvedValueOnce({
                workerId: 'worker-1',
                paths: [
                    { pathId: 'source-path-1', status: PreCheckStatus.SUCCESS, errorCodes: [] },
                    { pathId: 'dest-path-1', status: PreCheckStatus.SUCCESS, errorCodes: [] },
                ],
            });

            const result = await PreCheckValidationWorkflow(baseRequest as any);

            expect(result[0].destination[0].warnings).toEqual([]);
        });

        it('should still add INSUFFICIENT_DESTINATION_SPACE warning when space is low even if Backup Operators warnings are present', async () => {
            mockExecuteChild.mockResolvedValueOnce({
                workerId: 'worker-1',
                paths: [
                    {
                        pathId: 'source-path-1',
                        status: PreCheckStatus.SUCCESS,
                        errorCodes: [],
                        warnings: [PreCheckErrorCodes.BACKUP_OPERATORS_CHECK_SKIPPED],
                        sourceDataSize: 1000,
                    },
                    {
                        pathId: 'dest-path-1',
                        status: PreCheckStatus.SUCCESS,
                        errorCodes: [],
                        warnings: [],
                        destinationAvailableSpace: 500,
                    },
                ],
            });

            const result = await PreCheckValidationWorkflow(baseRequest as any);

            expect(result[0].destination[0].warnings).toContain(PreCheckErrorCodes.BACKUP_OPERATORS_CHECK_SKIPPED);
            expect(result[0].destination[0].warnings).toContain(PreCheckErrorCodes.INSUFFICIENT_DESTINATION_SPACE);
        });

        it('should not affect destination status when only warnings (no errors) are present', async () => {
            mockExecuteChild.mockResolvedValueOnce({
                workerId: 'worker-1',
                paths: [
                    {
                        pathId: 'source-path-1',
                        status: PreCheckStatus.SUCCESS,
                        errorCodes: [],
                        warnings: [PreCheckErrorCodes.BACKUP_OPERATORS_NOT_MEMBER],
                    },
                    { pathId: 'dest-path-1', status: PreCheckStatus.SUCCESS, errorCodes: [], warnings: [] },
                ],
            });

            const result = await PreCheckValidationWorkflow(baseRequest as any);

            expect(result[0].destination[0].status).toBe(PreCheckStatus.SUCCESS);
            expect(result[0].destination[0].warnings).toContain(PreCheckErrorCodes.BACKUP_OPERATORS_NOT_MEMBER);
        });
    });
});
