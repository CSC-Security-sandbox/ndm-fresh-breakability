export const ALLOWED_KEYWORDS = [
  'nfs',
  'smb',
  'worker',
  'keycloak',
  'redis',
] as const;

export const SENSITIVE_PATTERNS = [
  'SECRET',
  'PASSWORD',
  'TOKEN',
  'CREDENTIAL',
] as const;

export const MASK_VALUE = '***MASKED***';

export const CSV_FILE_PREFIX = 'worker_env_logs_';

export const CSV_FILE_EXTENSION = '.csv';

export const WORKFLOW_TIMEOUTS = {
  PARENT_WORKFLOW_EXECUTION_TIMEOUT: '6h',
  PARENT_WORKFLOW_RUN_TIMEOUT: '6h',
  CHILD_WORKFLOW_EXECUTION_TIMEOUT: '5h',
  CHILD_WORKFLOW_RUN_TIMEOUT: '5h',
  ACTIVITY_TIMEOUT: '4h',
} as const;
