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