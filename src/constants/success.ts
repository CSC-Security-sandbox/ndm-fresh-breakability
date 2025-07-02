// This file is part of the API Response Handler library.

export enum HTTPStatusMappingCode {
    OK = 200,
    CREATED = 201,
    ACCEPTED = 202,
    NO_CONTENT = 204
}


// This library provides a set of constants for success messages used in API responses.
export enum MessageKey {
    CreateUser = 'create-user',
    UserStatus = 'user-status',
}



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
