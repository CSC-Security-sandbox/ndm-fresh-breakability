export enum EmailContentStatus {
  FIRING = 'firing',
  RESOLVED = 'resolved',
}

 export enum SuccessEmailType {
  CREATE_CONFIGURATION = 'create_configuration',
  ERROR_REMEDY = 'error_remedy',
  JOB_CREATION = 'job_creation',
  JOB_UPDATE = 'job_update',
  UPDATE_CONFIGURATION = 'update_configuration',
  WORKER_USAGE = 'worker_usage',
}

export type CreateConfigurationEmailContent = {
  configName: string;
  fileServers: {
    host: string;
    protocol: string;
    workerNames: string[];
  }[];
};

export type ErrorRemedyEmailContent = {
  jobType: string;
  jobRunId: string;
  sourceHost: string;
  sourcePath: string;
  targetHost: string;
  targetPath: string;
  errorRemedies: {
    errorCode: string;
    description: string;
    resolutionSteps: string;
    referenceCommands?: string;
  }[];
};

export type MigrateJobEmailContent = {
  savedJobConfigs: {
    id: string;
    sourcePath: string;
    targetPath: string;
    jobType: string;
  }[];
};

export type JobStatusUpdateEmailContent = {
  jobType: string;
  jobAction: string;
  sourcePath: {
    volumePath: string;
    fileServer: { host: string };
  };
  targetPath: {
    volumePath: string;
    fileServer: { host: string };
  };
};

export type ConfigUpdateEmailContent = {
  configName: string;
  removedWorkers: {
    workerName: string;
  }[];
  addedWorkers: {
    workerName: string;
  }[];
};

export type WorkerUsesEmailContent = {
  id: string;
  ip: string;
};