export const sanitisedeErrorResponse = (error: any) => {
  const sanitizedError = {
    response: error.response || 'An unexpected error occurred. Please try again later.',
    status: error.status || 500,
    message: error.message || 'An unexpected error occurred. Please try again later.',
    name: error.name || 'Error',
  };
  return sanitizedError;
}