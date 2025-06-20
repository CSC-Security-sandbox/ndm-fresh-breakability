// src/common/utils/response-handler.ts

import { ApiResponse, ErrorCatalog } from './response.interface';

export class ResponseHandler {
  static success<T, msg extends string>(
    data: T,
    message:  msg,
    status,
  ): ApiResponse<T> {
    return {
      status,
      message,
      data: data,
    };
  }
  static error<T, msg extends string>(
    data: T,
    message: msg,
    status,
  ): ApiResponse<T> {
    delete data['status'];
    return {
      status,
      message: ErrorCatalog[message['code']].displayMessage || message,
      data: undefined,
      error: {
        displayMessage: ErrorCatalog[message['code']].displayMessage,
        details: data,
      },
    };
  }
}
