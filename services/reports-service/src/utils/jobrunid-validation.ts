export const validateJobRunId = (jobRunId: string): boolean => {
  const regexToTest = /^[a-zA-Z0-9-]+$/;
  return regexToTest.test(jobRunId);
}