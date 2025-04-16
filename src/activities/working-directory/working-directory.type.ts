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
  INVALID_EXPORT_PATH = 'Invalid export path',
  INVALID_WORKING_DIRECTORY = 'Invalid working directory',
  PROTOCOL_NOT_SUPPORTED = 'The server does not support provided protocol version. Please use a valid protocol version.'
}
