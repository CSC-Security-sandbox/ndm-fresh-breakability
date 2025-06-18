export interface ApiResponse<T> {
  statusCode?: number; // HTTP status code
  status: string;
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
    message: string; // Error message
    displayMessage?: string; // User-friendly error message
    details?: any; // Additional error details (e.g., validation errors)
    code?: string | number; // Custom error code
    stack?: string; // Stack trace (optional, for debugging)
    correctiveAction?: string; // Suggested corrective action for the user
  };

  timestamp?: string; // ISO timestamp of the response
  path?: string; // Request path
}