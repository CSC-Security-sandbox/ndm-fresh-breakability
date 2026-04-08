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

export type AsupTransmissionStatus = 'transmitting' | 'completed' | 'failed';

export interface AsupTransmissionState {
  status: AsupTransmissionStatus;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface BundleStatus {
  isProcessing: boolean;
  isBundleReady: boolean;
  filters: any | null;
  createdAt: Date | null;
}
