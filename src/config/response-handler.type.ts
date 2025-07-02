//
export interface CustomSuccessDTO {
    apiEndPointKey: string, // This is the key for the API endpoint, e.g., "create-user"
    message: string, // custom Ui Notification message for success
    statusCode: string // custom HTTP status || other code for success ex.. 'PENDING', 'SUCCESS', 'FAILURE'
}
export interface CustomErrorDTO {
    apiEndPointKey: string, // This is the key for the API endpoint, e.g., "create-user"
    message: string, // custom Ui Notification message for error
    statusCode: string, //custom HTTP status || other code for success ex.. '22P02' from postgres,KC_COMM_003 from keycloak
    correctiveAction?: string, // corrective action message for error if there is any  steps
}

export interface ResponseHandlerOptions {
    service: string,
}