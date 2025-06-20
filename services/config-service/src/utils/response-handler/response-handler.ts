// src/common/utils/response-handler.ts

import { ApiResponse } from './response.interface';

export class ResponseHandler {
  static success<T>(data: T, message = 'Success'): ApiResponse<T> {
    return {
      status: data['status'] || 'success',
      message,
      data: {
        items: data,
      },
    };
  }

  static error(
    message = 'An error occurred',
    error: any = null,
  ): ApiResponse<null> {
    return {
      status: 'error',
      message,
      error,
    };
  }
}
