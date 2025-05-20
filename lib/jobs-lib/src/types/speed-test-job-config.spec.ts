import { FileServerDetails } from './file-server';
import { SpeedTestJobConfig } from './speed-test-job-config';
import { NFS } from './protocols';

describe('SpeedTestJobConfig Class', () => {
  it('should create and serialize SpeedTestJobConfig', () => {
    const sourceFileServer = new FileServerDetails('host', [ new NFS('root') ], 'pathId', 'path', 'username', 'password', 'workingDirectory');
    const fs2 = new FileServerDetails('', [ new NFS('') ], 'pathId', 'path', 'username', 'password', 'workingDirectory');
    const speedTestJobConfig = new SpeedTestJobConfig('job1', 'type1');
    const serialized = speedTestJobConfig.serialize();
    const newSpeedTestJobConfig = new SpeedTestJobConfig('', '');
    newSpeedTestJobConfig.deserialize(serialized);
    expect(newSpeedTestJobConfig.jobId).toBe('job1');
  });
});
