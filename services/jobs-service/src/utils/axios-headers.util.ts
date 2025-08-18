export const createAxiosHeaders = (projectId?: string): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (projectId) {
    headers['projectId'] = projectId;
  }

  return headers;
};
