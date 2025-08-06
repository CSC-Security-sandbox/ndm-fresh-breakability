export class ACLError extends Error {
    constructor(message: string, public code: string, public details?: any) {
        super(message);
        this.name = 'ACLError';
    }
}

export class FileAccessError extends ACLError {
    constructor(filePath: string, originalError: Error) {
        super(`Cannot access file: ${filePath}`, 'FILE_ACCESS_ERROR', {
            filePath,
            originalError: originalError.message
        });
    }
}

export class CommandExecutionError extends ACLError {
    constructor(command: string, originalError: Error) {
        super(`Command execution failed: ${command}`, 'COMMAND_ERROR', {
            command,
            originalError: originalError.message
        });
    }
}

export class TimeoutError extends ACLError {
    constructor(command: string, timeout: number) {
        super(`Command timed out after ${timeout}ms`, 'TIMEOUT_ERROR', {
            command,
            timeout
        });
    }
}
