import { Protocol } from 'src/constants/enums';
import { Operations } from 'src/constants/status';
import { OperationToProtocol } from './mapper';

describe('OperationToProtocol', () => {
  it('should return Protocol.NFS for NFS operations', () => {
    expect(
      OperationToProtocol(
        Operations.LIST_NFS_PATHS || Operations.VALIDATE_NFS_CONNECTION
      )
    ).toBe(Protocol.NFS);
  });

  it('should return Protocol.SMB for SMB operations', () => {
    expect(
      OperationToProtocol(
        Operations.LIST_SMB_PATHS || Operations.VALIDATE_SMB_CONNECTION
      )
    ).toBe(Protocol.SMB);
  });

  it('should throw an error for invalid operations', () => {
    expect(() =>
      OperationToProtocol('INVALID_OPERATION' as Operations)
    ).toThrow('Invalid Operation');
  });
});
