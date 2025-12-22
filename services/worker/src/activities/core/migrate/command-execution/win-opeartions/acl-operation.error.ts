export class SourceAclError extends Error {
    constructor(message: string, public readonly code: string = 'SRC_ACL_ERROR') {
        super(message);
        this.name = 'SRC_ACL_ERROR';
    }
}

export class TargetAclError extends Error {
    constructor(message: string, public readonly code: string = 'TARGET_ACL_ERROR') {
        super(message);
        this.name = 'TARGET_ACL_ERROR';
    }   
}

export class WindowsAPINotAvailableError extends Error {
    constructor(message: string = 'Windows API is not available for ADS detection', public readonly code: string = 'WINDOWS_API_UNAVAILABLE') {
        super(message);
        this.name = 'WindowsAPINotAvailableError';
    }
}