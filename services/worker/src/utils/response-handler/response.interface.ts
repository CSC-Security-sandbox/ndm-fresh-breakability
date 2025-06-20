export interface ApiResponse<T> {
  status: string; // success, error, Complete, running
  message: string; // General message for the response
  data?: {
    items?: T;
    meta?: {
      total?: number; // For pagination: total items
      page?: number; // For pagination: current page
      pageSize?: number;
      hasMore?: boolean,// For pagination: items per page
    };
  }; // Payload for successful responses
  error?: {
    displayMessage?: string; // User-friendly error message
    details?: any; // Additional error details (e.g.,traceID, workerID, ProjectId)
    correctiveAction?: string; // Suggested corrective action for the user
  };
}

export const ErrorCatalog = {
  ERR_INVALID_ARG_TYPE: {
    message: `The "command" argument must be of type string. Received undefined`,
    displayMessage: 'Please provide a valid command as a string.',
  },
  INVALID_INPUT: {
    message: 'The input provided is invalid.',
    displayMessage: 'Check your input and try again.',
  },
  // Add more key-value pairs as needed
};


