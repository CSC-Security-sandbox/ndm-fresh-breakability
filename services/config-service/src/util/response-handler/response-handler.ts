// src/common/utils/response-handler.ts

import { ApiResponse } from './response.interface';

export class ResponseHandler {
  static success<T>(
    data: T,
    message = 'Success',
    statusCode = 200,
  ): ApiResponse<T> {
    return {
      status: '',
      statusCode,
      message,
      data: {
        items: data,
      },
    };
  }

  static error(
    message = 'An error occurred',
    error: any = null,
    statusCode = 500,
  ): ApiResponse<null> {
    return {
      status: 'error',
      statusCode,
      message,
      error,
    };
  }
}
