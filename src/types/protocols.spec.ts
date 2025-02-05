import { Protocol, NFS, SMB, ProtocolType } from './protocols';

describe('Protocol Classes', () => {
  it('should create an NFS instance', () => {
    const nfs = new NFS('user', 'pass');
    expect(nfs.type).toBe(ProtocolType.NFS);
    expect(nfs.serialize()).toContain('user');
  });

  it('should create an SMB instance', () => {
    const smb = new SMB('user', 'pass');
    expect(smb.type).toBe(ProtocolType.SMB);
    expect(smb.serialize()).toContain('user');
  });

  it('should deserialize correctly', () => {
    const smb = new SMB('user', 'pass');
    const json = smb.serialize();
    const newSmb = new SMB('', '');
    newSmb.deserialize(json);
    expect(newSmb.serialize()).toBe(json);
  });
});
