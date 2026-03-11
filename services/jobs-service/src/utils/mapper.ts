import * as parser from 'cron-parser';
import { JobType } from 'src/constants/enums';
import { Logger } from '@nestjs/common';
const logger = new Logger('nextDate');

export const nextDate = (
  jobType: string,
  runDate: Date | null,
  cron: string | null,
): Date | null => {
  try {
    const now = new Date();

    if (runDate instanceof Date && runDate > now) {
      return runDate;
    }

    if (jobType === JobType.MIGRATE && cron) {
      const interval = parser.parseExpression(cron, { currentDate: now });
      return interval.next().toDate();
    }
    return null;
  } catch (error) {
    logger.error('Error parsing cron expression:', (error as Error).message);
    return null;
  }
};
