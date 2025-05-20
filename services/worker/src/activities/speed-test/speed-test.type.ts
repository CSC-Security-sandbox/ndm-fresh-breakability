import { TaskStats } from "@netapp-cloud-datamigrate/jobs-lib";

export interface SpeedTestOutput {
    errors: string[];
    success: boolean;
    result: TaskStats;
}