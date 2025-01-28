import { FileServerDetails } from './file-server';

describe('FileServerDetails Class', () => {
  it('should create and serialize FileServerDetails', () => {
    const fileServerDetails = new FileServerDetails('host', []);
    const serialized = fileServerDetails.serialize();
    const newFileServerDetails = new FileServerDetails('', []);
    newFileServerDetails.deserialize(serialized);
    expect(newFileServerDetails.hostname).toBe('host');
  });
});
