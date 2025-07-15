//Error codes and their corresponding HTTP status codes
export enum ErrorHTTPStatusCodeMapping {
    BAD_REQUEST = 400,
    UNAUTHORIZED = 401,
    FORBIDDEN = 403,
    NOT_FOUND = 404,
    CONFLICT = 409,
    UNPROCESSABLE_ENTITY = 422,
    INTERNAL_SERVER_ERROR = 500,
    NOT_IMPLEMENTED = 501,
    BAD_GATEWAY = 502,
    SERVICE_UNAVAILABLE = 503,
    GATEWAY_TIMEOUT = 504,
    // Add more as needed for your service
    POSTGRES_BAD_REQUEST = 400,
    '22P02' = 400, // Bad Request
}
// Error keys to get the error messages
export enum ErrorKey {
    InvalidArgType = 'ERR_INVALID_ARG_TYPE',
    InvalidInput = 'INVALID_INPUT',
    PostgresBadRequest = `22P02`, // PostgreSQL error code for invalid input syntax
    DefaultError = 'DEFAULT_ERROR', // Default error key for unexpected errors
}

type ErrorCatalogValue = {
    message: string;
};

// 3. ErrorCatalog Constant
export const ErrorCatalog: Record<ErrorKey, ErrorCatalogValue> = {
    [ErrorKey.InvalidArgType]: {
        message: 'Please provide a valid argument',
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
    [ErrorKey.DefaultError]: {
        message: 'An unexpected error occurred. Please try again later.',
    }
};
