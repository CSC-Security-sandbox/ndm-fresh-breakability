import { FileServerDetails } from './file-server';

describe('FileServerDetails Class', () => {
  it('should create and serialize FileServerDetails', () => {
    const fileServerDetails = new FileServerDetails('host', [], 'pathId', 'path', 'username', 'password', 'workingDirectory');
    const serialized = fileServerDetails.serialize();
    const newFileServerDetails = new FileServerDetails('', [], 'pathId', 'path', 'username', 'password', 'workingDirectory');
    newFileServerDetails.deserialize(serialized);
    expect(newFileServerDetails.hostname).toBe('host');
  });
});
