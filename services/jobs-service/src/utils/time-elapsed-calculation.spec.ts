import { timeElapsed } from "./time-elapsed-calculation";
import { JobRunStatus } from "src/constants/enums";

describe("timeElapsed", () => {
  it("should calculate time elapsed when job is paused and timeElapsed is provided", () => {
    const jobRun = {
      subStatus: JobRunStatus.Paused,
      timeElapsed: new Date(2000),
      starttime: new Date(1000),
    };
    const result = timeElapsed(jobRun);
    expect(result).toBe(1000);
  });

  it("should calculate time elapsed when job is paused and timeElapsed is not provided", () => {
    const jobRun = {
      subStatus: JobRunStatus.Paused,
      starttime: new Date(Date.now() - 5000),
    };
    const result = timeElapsed(jobRun);
    expect(result).toBeGreaterThanOrEqual(5000);
  });

  it("should calculate time elapsed when job is completed and endtime is provided", () => {
    const jobRun = {
      status: JobRunStatus.Completed,
      starttime: new Date(1000),
      endtime: new Date(2000),
    };
    const result = timeElapsed(jobRun);
    expect(result).toBe(1000);
  });

  it("should calculate time elapsed when job is completed and endtime is not provided", () => {
    const jobRun = {
      status: JobRunStatus.Completed,
      starttime: new Date(Date.now() - 5000),
    };
    const result = timeElapsed(jobRun);
    expect(result).toBeGreaterThanOrEqual(5000);
  });

  it("should handle missing starttime gracefully", () => {
    const jobRun = {
      status: JobRunStatus.Completed,
      endtime: new Date(),
    };
    expect(() => timeElapsed(jobRun)).toThrow();
  });
});