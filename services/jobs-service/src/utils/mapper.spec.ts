import {
  JobType,
  OperationType,
  Protocol,
  TaskType,
} from 'src/constants/enums';
import { nextDate } from './mapper';
import * as parser from 'cron-parser';

jest.mock('cron-parser', () => ({
  parseExpression: jest.fn(),
}));

describe('nextDate', () => {
  describe('nextDate', () => {
    it('should return runDate if jobType is DISCOVER and runDate is in the future', () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60);
      const result = nextDate(JobType.DISCOVER, futureDate, '');
      expect(result).toBe(futureDate);
    });

    it('should return null if jobType is DISCOVER and runDate is not in the future', () => {
      const pastDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour in the past
      const result = nextDate(JobType.DISCOVER, pastDate, '');
      expect(result).toBeNull();
    });

    it('should return null if jobType is DISCOVER and runDate is null', () => {
      const result = nextDate(JobType.DISCOVER, null, '');
      expect(result).toBeNull();
    });

    it('should return the next date parsed from the cron string if jobType is MIGRATE', () => {
      const mockNextDate = new Date(Date.now() + 1000 * 60 * 60); // 1 hour in the future
      const mockCronExpression = {
        next: jest.fn().mockReturnValue({ toDate: () => mockNextDate }),
      };
      (parser.parseExpression as jest.Mock).mockReturnValue(mockCronExpression);
      const cron = '*/5 * * * *';

      const result = nextDate(JobType.MIGRATE, null, cron);
      expect(parser.parseExpression).toHaveBeenCalledWith(
        cron,
        expect.objectContaining({ currentDate: expect.any(Date) }),
      );
      expect(result).toBe(mockNextDate);
    });

    it('should return null if jobType is not DISCOVER and cron string is null', () => {
      const result = nextDate('OTHER_JOB_TYPE', null, null);
      expect(result).toBeNull();
    });

    it('should return null if jobType is not DISCOVER and cron string is invalid', () => {
      (parser.parseExpression as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid cron expression');
      });
      const result = nextDate('OTHER_JOB_TYPE', null, 'invalid-cron');
      expect(result).toBeNull();
    });

    // add test cases for CUT_OVER job type
    it('should return runDate if jobType is CUT_OVER and runDate is in the future', () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60);
      const result = nextDate(JobType.CUT_OVER, futureDate, '');
      expect(result).toBe(futureDate);
    });

    it('should return null if jobType is CUT_OVER and runDate is not in the future', () => {
      const pastDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour in the past
      const result = nextDate(JobType.CUT_OVER, pastDate, '');
      expect(result).toBeNull();
    });

    it('should return null if jobType is CUT_OVER and runDate is null', () => {
      const result = nextDate(JobType.CUT_OVER, null, '');
      expect(result).toBeNull();
    });
  });
});
