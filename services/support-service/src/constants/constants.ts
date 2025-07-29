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
