import { FileServerDetails } from './file-server';
import { JobConfig } from './job-config';
import { NFS } from './protocols';

describe('JobConfig Class', () => {
  it('should create and serialize JobConfig', () => {
    const sourceFileServer = new FileServerDetails('host', [ new NFS('root') ]);
    const fs2 = new FileServerDetails('', [ new NFS('') ]);
    const jobConfig = new JobConfig('job1', 'type1', sourceFileServer, '/source');
    const serialized = jobConfig.serialize();
    const newJobConfig = new JobConfig('', '', fs2, '');
    newJobConfig.deserialize(serialized);
    expect(newJobConfig.jobId).toBe('job1');
  });
});
