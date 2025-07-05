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
    | ((state: string, email: string) => { message: string });

export const MessageCatalog: Record<MessageKey, MessageCatalogValue> = {
    [MessageKey.Default]: {
        message: 'Request processed successfully.'
    }
};
