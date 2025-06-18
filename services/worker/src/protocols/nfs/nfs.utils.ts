
export const  handleConnectionError = (error: any, host: string, port: number) => {
    switch (error.code) {
        case 'ENOTFOUND':
            return `Host ${host} not found.`;
        case 'EHOSTUNREACH':
            return `Host ${host} unreachable.`;
        case 'ECONNREFUSED':
            return `Connection refused by server at ${host}:${port}.`;
        case 'ETIMEDOUT':
            return `Connection to ${host}:${port} timed out.`;
        case 'EACCES':
            return `Permission denied to access ${host}:${port}.`;
        case 'EMFILE':
            return `Too many open files. Adjust the file descriptor limit.`;
        case 'ECONNRESET':
            return `Connection reset by server at ${host}:${port}.`;
        default:
            return `Unexpected error while connecting to ${host}:${port} - ${error.message}`;
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
      .map((line) => line.split(' ')[0]);

    return exports;
  }