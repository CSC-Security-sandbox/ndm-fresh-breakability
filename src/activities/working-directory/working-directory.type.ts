export enum ConfigStatus {
  ACTIVE = 'ACTIVE',
  DRAFT = 'DRAFT',
  ERRORED = 'ERRORED'
}

export interface ConfigStatusPayload {
  configId: string;
  status: ConfigStatus | null;
  errorMessage: string | null
}

export enum ConfigError {
  INVALID_EXPORT_PATH = 'INVALID_EXPORT_PATH',
  INVALID_WORKING_DIRECTORY = 'INVALID_WORKING_DIRECTORY'
}
