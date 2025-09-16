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