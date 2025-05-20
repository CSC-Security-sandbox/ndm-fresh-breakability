export interface DiscoveryJobRequest {
    traceId: string;
    payload: DiscoveryJobPayload;
    options: any;
  }
  
  export interface DiscoveryJobPayload {
    preserveAccessTime: boolean;
    excludeFilePatterns: string;
    excludeOlderThan: string | null;
    connection: Connection;
    workers: string[];
    jobType: 'DISCOVER' | string;
    skipFile: string | null;
  }
  
  export interface Connection {
    sourceCredential: SourceCredential;
  }
  
  export interface SourceCredential {
    path: string;
    pathId: string;
    protocol: 'NFS' | string;
    username: string;
    password: string;
    host: string;
    workingDirectory: string;
    protocolVersion: string;
  }
  
  export interface WorkflowOptions {
    workflowExecutionTimeout: string;
    workflowTaskTimeout: string;
    workflowRunTimeout: string;
    startDelay: string;
  }
  