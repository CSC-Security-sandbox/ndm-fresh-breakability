/**
 * Returns a safe string representation of an unknown error for logging.
 * Avoids Object's default '[object Object]' when stringifying plain objects.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error === null) {
    return 'null';
  }
  if (error === undefined) {
    return 'undefined';
  }
  if (typeof error === 'object') {
    return JSON.stringify(error);
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'number' || typeof error === 'boolean') {
    return String(error);
  }
  if (typeof error === 'symbol') {
    return error.description != null ? String(error.description) : 'Symbol';
  }
  if (typeof error === 'bigint') {
    return error.toString();
  }
  return 'unknown';
}
