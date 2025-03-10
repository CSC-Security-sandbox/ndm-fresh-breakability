import { JobStatus } from './enums';
import { JobState } from './job-state';

describe.only('JobState Class', () => {
    it('should create and serialize JobState', () => {
        const jobState = new JobState(['worker1'], 1, 2, ['worker1'], JobStatus.Pending, ['worker1']);
        const serialized = jobState.serialize();
        console.log(serialized);
        const newJobState = new JobState([''], 0, 0, [''], JobStatus.Pending, ['worker1']);
        newJobState.deserialize(serialized);
        expect(newJobState.status).toBe(JobStatus.Pending);
    });
});