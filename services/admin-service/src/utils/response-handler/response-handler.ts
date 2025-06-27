// src/common/utils/response-handler.ts
import {
  ApiResponse,
  ErrorCatalog,
  MessageCatalog,
} from './response-interface';

export const setMessage = <T, msg extends string>(message, data: T): msg => {
  let responseMessage = 'Request Processed Successfully';
  if (message) {
    const functionality = message.split('/').pop()!;

    if (!!data['user_status']) {
      let state =
        !!data['user_status'] && data['user_status'] === 'active'
          ? 'Enabled'
          : 'Disabled';
      let email = data['email'] || '';
      responseMessage = MessageCatalog[functionality](state, email).message;
    } else if (typeof data === 'object' && (data as any).message) {
      responseMessage = (data as any).message;
    } else if (MessageCatalog[functionality]?.message) {
      responseMessage = MessageCatalog[functionality]?.message;
    }
  }
  return responseMessage as msg;
};
export class ResponseHandler {
  static success<T, msg extends string>(data: T, message: msg): ApiResponse<T> {
    message = setMessage(message, data);
    let responseData: any = {};
    if (Array.isArray(data)) {
      responseData.items = [...data];
    } else if (typeof data === 'object' && data !== null) {
      const { id, message: _msg, ...rest } = data as any;
      if (id !== undefined) responseData.id = id;
      responseData.items = { ...rest };
    } else {
      responseData.items = data;
    }
    return {
      message: message,
      data: responseData,
    };
  }
  static error<T>(data: T): ApiResponse<T> {
    const errorMsg =
      (data as any)?.response?.message ?? ErrorCatalog[data['code']]?.message;
    return {
      message: errorMsg,
      data: undefined,
      error: {
        displayMessage: errorMsg,
      },
    };
  }
}
