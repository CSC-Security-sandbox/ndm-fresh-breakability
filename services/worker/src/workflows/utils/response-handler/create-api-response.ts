export enum RESPONSESTATUS {
  SUCCESS = 'success',
  ERROR = 'error',
}
export class ApiResponse<T = any> {
  statusCode?: number; // HTTP status code
  status: string;
  message: string; // General message for the response
  data?: {
    items: [];
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

export class CreatApiResponse {
  static apiResponse(status: string, data: any): ApiResponse {
    console.log('DaTAAAA INSIDE THE API RESPONSEEE', data);
    const response: ApiResponse = {
      status,
      message: data.message, // Default error message
      timestamp: new Date().toISOString(), // Current timestamp
    };
    delete data.message;
    //response.data = data;
    if (status === RESPONSESTATUS.SUCCESS) {
      response.data = data;
      response.statusCode = 200;
    } else if (status === RESPONSESTATUS.ERROR) {
      response.statusCode = 500;
      response.error = {
        message: response.message, // Error message
        displayMessage: response.message,
        details: data, // User-friendly error message
      };
    }
    console.log('dataaa>>>>>>>>>>>>>', data, response);
    return response;
  }
}


/*
interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T | null;
  errorCode?: string;
  meta?: Record<string, any>;
}

class ApiResponseBuilder<T = any> {
  private response: ApiResponse<T>;

  constructor() {
    this.response = {
      success: true,
      message: '',
      data: null,
    };
  }

  setSuccess(success: boolean): this {
    this.response.success = success;
    return this;
  }

  setMessage(message: string): this {
    this.response.message = message;
    return this;
  }

  setData(data: T): this {
    this.response.data = data;
    return this;
  }

  setErrorCode(errorCode: string): this {
    this.response.errorCode = errorCode;
    return this;
  }

  setMeta(meta: Record<string, any>): this {
    this.response.meta = meta;
    return this;
  }

  build(): ApiResponse<T> {
    return this.response;
  }
}
 */
