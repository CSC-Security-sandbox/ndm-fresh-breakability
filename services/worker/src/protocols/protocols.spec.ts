import { Protocols, ProtocolTypes } from './protocols';
import { SMBProtocol } from './smb/smb.protocol';
import { NFSProtocol } from './nfs/nfs.protocol';
import { LoggerFactory } from '@netapp-cloud-datamigrate/logger-lib';

jest.mock('./smb/smb.protocol', () => {
    return {
        SMBProtocol: jest.fn().mockImplementation(() => ({
            mockMethod: jest.fn(),
        })),
    };
});

jest.mock('./nfs/nfs.protocol', () => {
    return {
        NFSProtocol: jest.fn().mockImplementation(() => ({
            mockMethod: jest.fn(),
        })),
    };
});

describe('Protocols', () => {
    let protocols: Protocols;

    beforeEach(() => {
        jest.clearAllMocks();
        const loggerFactory = {} as LoggerFactory;
        protocols = new Protocols(new NFSProtocol(loggerFactory), new SMBProtocol(loggerFactory));
    });

    it('should return an instance of SMBProtocol when protocolType is SMB', () => {
        protocols.getProtocol(ProtocolTypes.SMB);
        expect(SMBProtocol).toHaveBeenCalledTimes(1);

    });

    it('should return an instance of NFSProtocol when protocolType is NFS', () => {
        protocols.getProtocol(ProtocolTypes.NFS);
        expect(NFSProtocol).toHaveBeenCalledTimes(1);

    });

    it('should throw an error for unsupported protocol types', () => {
        const unsupportedProtocol = 'UNKNOWN' as ProtocolTypes;

        expect(() => protocols.getProtocol(unsupportedProtocol)).toThrowError(
            `Unsupported protocol type: ${unsupportedProtocol}`
        );
    });
});
