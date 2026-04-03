import { Duration } from '@temporalio/common';

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

import type { Duration } from '@temporalio/common';

export const WORKFLOW_TIMEOUTS = {
  PARENT_WORKFLOW_EXECUTION_TIMEOUT: '24h' as Duration,
  PARENT_WORKFLOW_RUN_TIMEOUT: '24h' as Duration,
  CHILD_WORKFLOW_EXECUTION_TIMEOUT: '19h' as Duration,
  CHILD_WORKFLOW_RUN_TIMEOUT: '19h' as Duration,
  ACTIVITY_TIMEOUT: '6h' as Duration,
};
