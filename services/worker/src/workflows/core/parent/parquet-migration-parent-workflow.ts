import { JobRunStatus } from 'src/activities/common/enums';
import { waitUntilRedisMemoryOk } from 'src/workflows/utils/memory-utils';
import { executeCleanup } from '../common/execute-cleanup-workflow';
import { executeParquetMigrationChildWorkflows } from '../common/parquet-execute-migration-child-workflows';
import { handleReporting } from '../common/handle-reporting';
import { executeWorkerSetup } from '../common/execute-setup-workflow';



interface ParquetMigrationWorkflowInput {
    traceId: string;
    payload: {
        workers: string[];
    };
    options?: Record<string, any>;
}
interface ParquetMigrationWorkflowOutput {
    traceId: string;
    setupCompletedWorkers: string[];
    failedWorkers: string[];
    fileCount: number;
    dirCount: number;
    status: JobRunStatus;
    excludedPaths?: Array<{ path: string; isDirectory?: boolean; matchedPattern?: string }>;
    skippedPaths?: Array<{ path: string; isDirectory?: boolean }>;
}


export const ParquetMigrationWorkflow = async ({
    traceId,
    payload,
    options = {},
}: ParquetMigrationWorkflowInput): Promise<ParquetMigrationWorkflowOutput> => {
    const output: ParquetMigrationWorkflowOutput = {
        traceId: traceId,
        setupCompletedWorkers: [],
        dirCount: 0,
        fileCount: 0,
        failedWorkers: [],
        status: JobRunStatus.Ready,
    };

    // Setup workers
    const setupWorkersExecResult = await executeWorkerSetup({ jobRunId: traceId, workerIds: payload.workers, options });
    output.setupCompletedWorkers = setupWorkersExecResult.setupCompletedWorkers;
    output.failedWorkers = setupWorkersExecResult.failedWorkers;

    // Validate Redis memory
    await waitUntilRedisMemoryOk(traceId);

    // Start parquet-enabled scan + sync child workflows
    const migrationWorkflowExecResult = await executeParquetMigrationChildWorkflows({ jobRunId: traceId });
    output.fileCount = migrationWorkflowExecResult.fileCount;
    output.dirCount = migrationWorkflowExecResult.dirCount;
    output.status = migrationWorkflowExecResult.status;

    // Reporting
    await handleReporting(traceId, output.status, {});

    // Cleanup
    await executeCleanup({ jobRunId: traceId, workerIds: output.setupCompletedWorkers, options });

    return output
}
