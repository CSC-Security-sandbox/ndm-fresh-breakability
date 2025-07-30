export interface CustomSuccessDTO {
    apiEndPointKey: string, // This is the key for the API endpoint, e.g., "create-user"
    method?: string, // HTTP method for the API endpoint, e.g., "POST", "PATCH"
    message: string, // custom Ui Notification message for success
    statusCode: string // custom HTTP status || other code for success ex.. 'PENDING', 'SUCCESS', 'FAILURE'
}