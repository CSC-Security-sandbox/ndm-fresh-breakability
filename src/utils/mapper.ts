import * as parser from 'cron-parser';
import { JobType } from "src/constants/enums";
``
export const nextDate = (jobType: string, runDate: Date, cron: string) => {
    switch(jobType) {
        case JobType.DISCOVER:
            return runDate && runDate > new Date() ? runDate : null;
        case JobType.CUT_OVER:
                return runDate && runDate > new Date() ? runDate : null;
        default:
            return cron ? parser.parseExpression(cron).next().toDate(): null
    }
}