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
  PARENT_WORKFLOW_EXECUTION_TIMEOUT: '24h',
  PARENT_WORKFLOW_RUN_TIMEOUT: '24h',
  CHILD_WORKFLOW_EXECUTION_TIMEOUT: '19h',
  CHILD_WORKFLOW_RUN_TIMEOUT: '19h',
  ACTIVITY_TIMEOUT: '6h',
} as const;
