export const traceIdValidation = (traceId: string) => {
  // Validating traceId: It must be alphanumeric and 36 characters as it is a UUID
  const traceIdRegex = /^[a-zA-Z0-9_-]{36}$/;
  return traceIdRegex.test(traceId);
}