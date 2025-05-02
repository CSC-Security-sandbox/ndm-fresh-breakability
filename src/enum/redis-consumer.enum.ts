

export class StreamStatus {
    isStreamActive: boolean;
    streamKey: string;
    jobRunId: string;
    readerName: string;
    consumerType: string;
}

export enum WorkFlows {
    DISCOVERY = 'DiscoveryWorkflow',
    PRECHECK = 'PreCheckValidationWorkflow',
    MIGRATE = 'MigrationWorkflow',
    CUT_OVER = 'CutOverWorkFlow',
}

export enum ConsumerType {
    files = "files",
    directories = "directories",
    tasks = "tasks",
    updatedTask = "updatedTask",
    errors = 'errors',
    migrationTask = "migrationTask"
}
