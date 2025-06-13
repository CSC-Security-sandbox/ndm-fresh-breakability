export const traceIdValidation = (traceId: string) => {
  const traceIdRegex = /^[a-zA-Z0-9_-]{36}$/;
  const sanitizedTraceId = traceId.replace(/[^a-zA-Z0-9-]/g, '');
  return traceIdRegex.test(sanitizedTraceId) && sanitizedTraceId.length === 36;
}