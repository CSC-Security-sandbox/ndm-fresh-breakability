import { Protocols, ProtocolTypes } from './protocols';
import { SMBProtocol } from './protocols/smb.protocol';
import { NFSProtocol } from './protocols/nfs.protocol';

describe('Protocols', () => {
  describe('getProtocol', () => {
    // it('should return an instance of SMBProtocol when protocol type is SMB', () => {
    //   const protocol = Protocols.getProtocol(ProtocolTypes.SMB);
    //   expect(protocol).toBeInstanceOf(SMBProtocol);
    // });

    // it('should return an instance of NFSProtocol when protocol type is NFS', () => {
    //   const protocol = Protocols.getProtocol(ProtocolTypes.NFS);
    //   expect(protocol).toBeInstanceOf(NFSProtocol);
    // });

    it('should throw an error for an unsupported protocol type', () => {
      const invalidProtocolType = 'INVALID' as ProtocolTypes;
      expect(() => Protocols.getProtocol(invalidProtocolType)).toThrowError(
        `Unsupported protocol type: ${invalidProtocolType}`
      );
    });
  });
});
