// services/admin-service/src/utils/response-handler/response-interface.ts

// 1. Enum for catalog keys
export enum MessageKey {
  CreateUser = 'create-user',
  UserStatus = 'user-status',
}

export enum ErrorKey {
  InvalidArgType = 'ERR_INVALID_ARG_TYPE',
  InvalidInput = 'INVALID_INPUT',
  PostgresBadRequest = `22P02`, // PostgreSQL error code for invalid input syntax
}
export enum HTTPStatusCode {
  '22P02' = 400, // Bad Request
}

// 2. ApiResponse interface (unchanged, but can be generic)
export interface ApiResponse<T> {
  message: string;
  data?: {
    items?: T;
    meta?: {
      total?: number;
      page?: number;
      pageSize?: number;
      hasMore?: boolean;
    };
  };
  error?: {
    displayMessage?: string;
    details?: any;
    correctiveAction?: string;
  };
}

type ErrorCatalogValue = {
  message: string;
};

// 3. ErrorCatalog interface
export const ErrorCatalog: Record<ErrorKey, ErrorCatalogValue> = {
  [ErrorKey.InvalidArgType]: {
    message: 'Please provide a valid command as a string.',
  },
  [ErrorKey.InvalidInput]: {
    message:
      'The input provided is invalid, Please Check your input and try again.',
  },
  [ErrorKey.PostgresBadRequest]: {
    // message: "We couldn't process your request due to an invalid input format. Please check your data and try again. (Error Code: 22P02)",
    message:
      'Please enter a valid ID or format. It looks like something went wrong with the data you provided.',
  },
};

// 4. Typed MessageCatalog
type MessageCatalogValue =
  | { message: string }
  | ((state: string, email: string) => { message: string });

export const MessageCatalog: Record<MessageKey, MessageCatalogValue> = {
  [MessageKey.CreateUser]: {
    message: 'User Created successfully.',
  },
  [MessageKey.UserStatus]: (state: string, email: string) => ({
    message: `Access has been successfully ${state} for a user: ${email}`,
  }),
};
