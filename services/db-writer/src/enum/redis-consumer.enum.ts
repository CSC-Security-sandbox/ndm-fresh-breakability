

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
    RETRY = 'RetryMigrationWorkflow',
}

export enum ConsumerType {
    files = "files",
    tasks = "tasks",
    errors = 'errors'
}
