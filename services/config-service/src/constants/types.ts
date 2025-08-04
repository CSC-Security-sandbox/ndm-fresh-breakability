export class WorkerConfiguration {
    workerId: string;
    configName: string;
    taskQueueId: string;
    dynamicTaskQueue: boolean;    
}

export type UserDetails = {
    traceId: string;
    user: {
        id: string;
        roles: Role[];
    };
};

export type Role = {
    role_name: string;
    projects: string[];
    permissions: string[];
};

export interface BundleStatus {
  isProcessing: boolean;
  isBundleReady: boolean;
  filters: any | null;
  createdAt: Date | null;
}
