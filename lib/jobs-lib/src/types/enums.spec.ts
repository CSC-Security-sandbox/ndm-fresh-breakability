import { JobType } from './enums';

describe('JobType Enum', () => {
  it('should have correct enum values', () => {
    expect(JobType.VALIDATE_CONNECTION).toBe('validate_connection');
    expect(JobType.DISCOVERY).toBe('discovery');
    expect(JobType.MIGRATION).toBe('migration');
    expect(JobType.CUTOVER).toBe('cutover');
    expect(JobType.SPEED_TEST).toBe('speed_test');
  });
});
