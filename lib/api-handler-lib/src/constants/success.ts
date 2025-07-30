// This file is part of the API Response Handler library.

export enum HTTPStatusMappingCode {
    OK = 200,
    CREATED = 201,
    ACCEPTED = 202,
    NO_CONTENT = 204
}
// This library provides a set of constants for success messages used in API responses.
export enum MessageKey {
  Default= 'default',
}
// 4. Typed MessageCatalog
type MessageCatalogValue =
    | { message: string }
    | ((...args: any[]) => { message: string });

/*
// Example usage of MessageCatalogValue:

// Static message
    [MessageKey.Default]: {
        message: 'Request processed successfully.'
    },
    
// Dynamic message functions
    [MessageKey.UserWelcome]: (...args: any[]) => {
        const [email, state, role] = args;
        return {
            message: `Welcome ${email}! Your ${role} account is active in ${state}.`
        };
    },
*/
export const MessageCatalog: Record<MessageKey, MessageCatalogValue> = {
    [MessageKey.Default]: {
        message: 'Request processed successfully.'
    }
};
