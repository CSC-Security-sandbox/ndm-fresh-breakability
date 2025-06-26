// services/admin-service/src/utils/response-handler/response-interface.ts

// 1. Enum for catalog keys
export enum MessageKey {
  CreateUser = 'create-user',
  UserStatus = 'user-status',
}

export enum ErrorKey {
  InvalidArgType = 'ERR_INVALID_ARG_TYPE',
  InvalidInput = 'INVALID_INPUT',
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

// 3. Typed ErrorCatalog
export const ErrorCatalog: Record<
  ErrorKey,
  { message: string; displayMessage: string }
> = {
  [ErrorKey.InvalidArgType]: {
    message: `The "command" argument must be of type string. Received undefined`,
    displayMessage: 'Please provide a valid command as a string.',
  },
  [ErrorKey.InvalidInput]: {
    message: 'The input provided is invalid.',
    displayMessage: 'Check your input and try again.',
  },
};

// 4. Typed MessageCatalog
export const MessageCatalog: Record<MessageKey, any> = {
  [MessageKey.CreateUser]: {
    message: `User Created successfully.`,
  },
  [MessageKey.UserStatus]: (state: string) => ({
    message: `User ${state} successfully`,
  }),
};
