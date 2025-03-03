export enum WorkFlowType {
    PARENT_WORKFLOW='parent-workflow-tasks',
    WORKER_SPECIFIC_WORKFLOW='worker-specific-tasks',
}

export enum WorkFlows {
    DISCOVERY = 'DiscoveryWorkflow',
    PRECHECK='PreCheckValidationWorkflow',
    MIGRATE = 'MigrationWorkflow'
}