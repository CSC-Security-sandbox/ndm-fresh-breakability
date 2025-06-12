export const traceIdValidation = (traceId: string) => {
  const traceIdRegex = /^[a-zA-Z0-9_-]{36}$/;
  return traceIdRegex.test(traceId);
}