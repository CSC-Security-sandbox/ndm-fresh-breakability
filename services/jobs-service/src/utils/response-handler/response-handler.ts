// src/common/utils/response-handler.ts

import { ApiResponse } from './response.interface';

export class ResponseHandler {
  static success<T, msg extends string>(
    data: T,
    message :msg,
    statusCode = 200,
  ): ApiResponse<T> {
    return {
      status: 'COMPLETE',
      statusCode,
      message,
      data: data,
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
