import { SmbErrors } from "./smb.protocol.type";


export const handleConnectionError = (errorCode: string) => {
    switch (errorCode) {
        case SmbErrors.ACCESS_DENIED:
            return `Error: Unable to connect to the server - ${SmbErrors.ACCESS_DENIED}`;
        case SmbErrors.CONNECTION_REFUSED:
            return `Error: Not a valid SMB server - ${SmbErrors.CONNECTION_REFUSED}`;
        case SmbErrors.LOGON_FAILURE:
            return `Error: Wrong credentials - ${SmbErrors.LOGON_FAILURE}`;
        case SmbErrors.TIMEOUT:
            return `Unable to connect to the server - ${SmbErrors.TIMEOUT}`;
        case SmbErrors.PROTOCOL_MISMATCH:
            return `Error: Protocol not supported by server - ${SmbErrors.PROTOCOL_MISMATCH}`;
        case SmbErrors.NETWORK_UNREACHABLE:
            return `Error: Network unreachable - ${SmbErrors.NETWORK_UNREACHABLE}`;
        case SmbErrors.HOST_UNREACHABLE:
            return `Error: Host unreachable - ${SmbErrors.HOST_UNREACHABLE}`;
        case SmbErrors.PORT_BLOCKED:
            return `Error: Protocol port blocked or not accessible - ${SmbErrors.PORT_BLOCKED}`;
        default:
            // Check for common error patterns in error messages
            if (typeof errorCode === 'string') {
                if (errorCode.includes('version') && errorCode.includes('mismatch')) {
                    return `Error: SMB version mismatch between client and server - ${errorCode}`;
                }
                if (errorCode.includes('protocol') && (errorCode.includes('not supported') || errorCode.includes('unsupported'))) {
                    return `Error: Protocol not supported by server - ${errorCode}`;
                }
                if (errorCode.includes('port') && (errorCode.includes('blocked') || errorCode.includes('filtered'))) {
                    return `Error: Protocol port blocked or not accessible - ${errorCode}`;
                }
                if (errorCode.includes('host') && (errorCode.includes('unreachable') || errorCode.includes('not found'))) {
                    return `Error: Host unreachable - ${errorCode}`;
                }
                if (errorCode.includes('os') && (errorCode.includes('not supported') || errorCode.includes('unsupported'))) {
                    return `Error: Host OS not supported for this operation - ${errorCode}`;
                }
            }
            return `Unable to connect to the server - ${errorCode}`;
    }
}

export const parseProtocolVersions = (output: string): string[] =>{
    if (!output) 
      return [];
    const dialects: string[] = [];
    const dialectsSection = output.split('| smb-protocols:')[1];
    if (dialectsSection) {
        const dialectLines = dialectsSection.split('\n').filter(line => line.trim().startsWith('|     ') || line.trim().startsWith('|_ '));
        dialectLines.forEach(line => {
            const dialect = line.split(/(?:\| {5}|\|_ {4})/)[1].trim();
            if (dialect) {
            dialects.push(dialect.replace(/:/g, '.').trim());
            }
        });
    }
    return dialects;
}

export const parseLinMacShares = (input: string) : string[] => {
    const lines = input.split('\n');
    const shares: string[] = [];
    let startParsing = false;
    const irrelevantPatterns = [ /^Sharename$/i, /^---------$/i, /^IPC\$$/i, /^print\$$/i, /^SMB\d$/i, /\$$/ ];
    for (const line of lines) {
        if (line.trim().startsWith('Sharename')) {
            startParsing = true;
            continue;
        }
        if (startParsing && (line.trim().startsWith('---------') || line.trim() === '')) 
            continue;

        if (startParsing) {
            const columns = line.trim().split(/\s+/);
            if (columns.length > 0) {
                const shareName = columns[0];
                if (!irrelevantPatterns.some((pattern) => pattern.test(shareName))) 
                    shares.push(`/${shareName}`);
            }
        }
    }
    return shares;
}


export const parseWindowsShares = (input : string) => {
    const lines = input.split('\n');
    const shareNames = [];
    let isParsing = false;
    lines.forEach(line => {
        if (line.trim().startsWith('---')) {
            isParsing = true;
            return;
        }
        if (line.includes('The command completed successfully')) 
            isParsing = false;
        
        if (isParsing && line.trim().length > 0) {
            const columns = line.trim().split(/\s+/);
            if (columns.length > 0) 
                shareNames.push(columns[0]); 
        }
    });
    return shareNames;
}