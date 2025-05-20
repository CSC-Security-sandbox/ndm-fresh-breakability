import { Protocols, ProtocolTypes } from './protocols';
import { SMBProtocol } from './smb/smb.protocol';
import { NFSProtocol } from './nfs/nfs.protocol';

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
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should return an instance of SMBProtocol when protocolType is SMB', () => {
        const protocol = Protocols.getProtocol(ProtocolTypes.SMB);
        expect(SMBProtocol).toHaveBeenCalledTimes(1);

    });

    it('should return an instance of NFSProtocol when protocolType is NFS', () => {
        const protocol = Protocols.getProtocol(ProtocolTypes.NFS);
        expect(NFSProtocol).toHaveBeenCalledTimes(1);

    });

    it('should throw an error for unsupported protocol types', () => {
        const unsupportedProtocol = 'UNKNOWN' as ProtocolTypes;

        expect(() => Protocols.getProtocol(unsupportedProtocol)).toThrowError(
            `Unsupported protocol type: ${unsupportedProtocol}`
        );
    });
});
