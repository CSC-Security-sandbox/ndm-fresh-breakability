import { handleConnectionError, parseExports, parseProtocolVersions } from "./nfs.utils";


describe('handleConnectionError', () => {
    it('should return the correct error message for ENOTFOUND', () => {
        const error = { code: 'ENOTFOUND' };
        const host = 'localhost';
        const port = 8080;
        const result = handleConnectionError(error, host, port);
        expect(result).toBe('Error: Host localhost not found.');
    });

    it('should return the correct error message for EHOSTUNREACH', () => {
        const error = { code: 'EHOSTUNREACH' };
        const host = 'localhost';
        const port = 8080;
        const result = handleConnectionError(error, host, port);
        expect(result).toBe('Error: Host localhost unreachable.');
    });

    it('should return the correct error message for ECONNREFUSED', () => {
        const error = { code: 'ECONNREFUSED' };
        const host = 'localhost';
        const port = 8080;
        const result = handleConnectionError(error, host, port);
        expect(result).toBe('Error: Connection refused by server at localhost:8080.');
    });

    it('should return the correct error message for ETIMEDOUT', () => {
        const error = { code: 'ETIMEDOUT' };
        const host = 'localhost';
        const port = 8080;
        const result = handleConnectionError(error, host, port);
        expect(result).toBe('Error: Connection to localhost:8080 timed out.');
    });

    it('should return the correct error message for EACCES', () => {
        const error = { code: 'EACCES' };
        const host = 'localhost';
        const port = 8080;
        const result = handleConnectionError(error, host, port);
        expect(result).toBe('Error: Permission denied to access localhost:8080.');
    });

    it('should return the correct error message for EMFILE', () => {
        const error = { code: 'EMFILE' };
        const host = 'localhost';
        const port = 8080;
        const result = handleConnectionError(error, host, port);
        expect(result).toBe('Error: Too many open files. Adjust the file descriptor limit.');
    });

    it('should return the correct error message for ECONNRESET', () => {
        const error = { code: 'ECONNRESET' };
        const host = 'localhost';
        const port = 8080;
        const result = handleConnectionError(error, host, port);
        expect(result).toBe('Error: Connection reset by server at localhost:8080.');
    });

    it('should return the default error message for unknown error codes', () => {
        const error = { code: 'UNKNOWN' , message: 'Some unexpected error'};
        const host = 'localhost';
        const port = 8080;
        const result = handleConnectionError(error, host, port);
        expect(result).toBe('Error: Unexpected error while connecting to localhost:8080 - Some unexpected error');
    });

    it('should return the correct error message for ENETUNREACH', () => {
        const error = { code: 'ENETUNREACH' };
        const host = 'localhost';
        const port = 8080;
        const result = handleConnectionError(error, host, port);
        expect(result).toBe('Error: Network unreachable for localhost:8080.');
    });

    it('should return the correct error message for EPROTO', () => {
        const error = { code: 'EPROTO' };
        const host = 'localhost';
        const port = 8080;
        const result = handleConnectionError(error, host, port);
        expect(result).toBe('Error: Protocol error connecting to localhost:8080.');
    });

    it('should return the correct error message for ENOPROTOOPT', () => {
        const error = { code: 'ENOPROTOOPT' };
        const host = 'localhost';
        const port = 8080;
        const result = handleConnectionError(error, host, port);
        expect(result).toBe('Error: Protocol not available for localhost:8080.');
    });

    it('should return the correct error message for ENOTSUP', () => {
        const error = { code: 'ENOTSUP' };
        const host = 'localhost';
        const port = 8080;
        const result = handleConnectionError(error, host, port);
        expect(result).toBe('Error: Host OS not supported for this operation on localhost:8080.');
    });

    it('should detect protocol port blocked from error message', () => {
        const error = { message: 'port 2049 blocked by firewall' };
        const host = 'localhost';
        const port = 2049;
        const result = handleConnectionError(error, host, port);
        expect(result).toBe('Error: Protocol port 2049 is blocked or not accessible on localhost.');
    });

    it('should detect filtered port from error message', () => {
        const error = { message: 'connection filtered on port 2049' };
        const host = 'localhost';
        const port = 2049;
        const result = handleConnectionError(error, host, port);
        expect(result).toBe('Error: Protocol port 2049 is blocked or not accessible on localhost.');
    });
});



describe('parseProtocolVersions', () => {
    it('should return an empty array when input is an empty string', () => {
        const result = parseProtocolVersions('');
        expect(result).toEqual([]);
    });

    it('should return an empty array when input is undefined or null', () => {
        const resultNull = parseProtocolVersions(null);
        const resultUndefined = parseProtocolVersions(undefined);
        expect(resultNull).toEqual([]);
        expect(resultUndefined).toEqual([]);
    });

    it('should correctly parse and return protocols ending with "nfs"', () => {
        const output = '1  2.0\n3  nfs\n5  2.0\n6  nfs';
        const result = parseProtocolVersions(output);
        expect(result).toEqual(['nfs', 'nfs']);
    });

    it('should return an empty array if no protocols end with "nfs"', () => {
        const output = '1  2.0\n3  3.0\n5  2.0\n6  3.0';
        const result = parseProtocolVersions(output);
        expect(result).toEqual([]);
    });
});




describe('parseExports', () => {
    it('should return an empty array when input is an empty string', () => {
        const result = parseExports('');
        expect(result).toEqual([]);
    });

    it('should return an empty array when input is undefined or null', () => {
        const resultNull = parseExports(null);
        const resultUndefined = parseExports(undefined);
        expect(resultNull).toEqual([]);
        expect(resultUndefined).toEqual([]);
    });

    it('should correctly parse and return exports starting with "/"', () => {
        const output = '/export/1\n/export/2\nother\n/export/3';
        const result = parseExports(output);
        expect(result).toEqual(['/export/1', '/export/2', '/export/3']);
    });

    it('should return an empty array if no exports start with "/"', () => {
        const output = 'other\nmore';
        const result = parseExports(output);
        expect(result).toEqual([]);
    });

    it('should handle newlines at the beginning and end of the string', () => {
        const output = '\n/export/1\n/export/2\n';
        const result = parseExports(output);
        expect(result).toEqual(['/export/1', '/export/2']);
    });
    
    it('should exclude root path ("/") from export list', () => {
    const output = '/export/1\n/export/2\nother\n/export/3\n/';
    const result = parseExports(output);
    expect(result).toEqual(['/export/1', '/export/2', '/export/3']);
    });
});
