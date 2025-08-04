
export const  handleConnectionError = (error: any, host: string, port: number) => {
    switch (error.code) {
        case 'ENOTFOUND':
            return `Error: Host ${host} not found.`;
        case 'EHOSTUNREACH':
            return `Error: Host ${host} unreachable.`;
        case 'ECONNREFUSED':
            return `Error: Connection refused by server at ${host}:${port}.`;
        case 'ETIMEDOUT':
            return `Error: Connection to ${host}:${port} timed out.`;
        case 'EACCES':
            return `Error: Permission denied to access ${host}:${port}.`;
        case 'EMFILE':
            return `Error: Too many open files. Adjust the file descriptor limit.`;
        case 'ECONNRESET':
            return `Error: Connection reset by server at ${host}:${port}.`;
        case 'ENETUNREACH':
            return `Error: Network unreachable for ${host}:${port}.`;
        case 'EPROTO':
            return `Error: Protocol error connecting to ${host}:${port}.`;
        case 'ENOPROTOOPT':
            return `Error: Protocol not available for ${host}:${port}.`;
        case 'ENOTSUP':
            return `Error: Host OS not supported for this operation on ${host}:${port}.`;
        default:
            // Check for protocol port blocked patterns
            if (error.message && (
                error.message.includes('port') && error.message.includes('blocked') ||
                error.message.includes('firewall') ||
                error.message.includes('filtered')
            )) {
                return `Error: Protocol port ${port} is blocked or not accessible on ${host}.`;
            }
            return `Error: Unexpected error while connecting to ${host}:${port} - ${error.message}`;
    }
}


export const parseProtocolVersions = (output: string): string[] => {
    if (!output) 
      return [];

    const lines = output.split('\n');
    const protocols = lines
      .filter((line) => line.endsWith('nfs'))
      .map((line) => line.split(' '))
      .map((tokens) => tokens.filter((token) => token.trim() !== ''))
      .map((tokens) => tokens[1])
    return protocols;
}

export const parseExports = (output: string): string[] =>{
    if (!output) 
      return [];

    const lines = output.split('\n');
    const exports = lines
      .filter((line) => line.startsWith('/'))
      .map((line) => line.split(' ')[0])
      .filter((path) => path !== '/');

    return exports;
  }