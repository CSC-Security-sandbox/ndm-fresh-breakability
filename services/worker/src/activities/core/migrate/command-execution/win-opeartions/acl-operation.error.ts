export class SrcACLReadError extends Error {
    constructor(message: string, public readonly code: string = 'SRC_ACL_READ_ERROR') {
        super(message);
        this.name = 'SRC_ACL_READ_ERROR';
    }
}

export class TgtACLWriteError extends Error {
    constructor(message: string, public readonly code: string = 'TGT_ACL_WRITE_ERROR') {
        super(message);
        this.name = 'TGT_ACL_WRITE_ERROR';
    }   
}