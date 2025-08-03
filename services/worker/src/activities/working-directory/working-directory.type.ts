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
  PROTOCOL_NOT_SUPPORTED = 'The server does not support provided protocol version. Please use a valid protocol version.',
  UNABLE_TO_DETECT_EXPORT_PATH = "The system couldn't retrieve the export path from the file server, possibly because the path is set to the root (/) which is not a valid or mountable path, or the server doesn't support the showmount command. Verify the export settings or try manual upload option.",
  HOST_OS_NOT_SUPPORTED = 'The operation is not supported by the host operating system.',
  PROTOCOL_PORT_BLOCKED = 'Protocol port is blocked or not accessible',
}
