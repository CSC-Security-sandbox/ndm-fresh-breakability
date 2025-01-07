
import { Operations } from 'src/constants/status';
import { JobType, OperationType, Protocol, TaskType } from 'src/constants/enums';
import { jobTypeToOperationType, nextDate, operationsTypeToTaskType, OperationToProtocol } from './mapper';
import * as parser from 'cron-parser'

jest.mock('cron-parser', () => ({
  parseExpression: jest.fn(),
}));

describe('OperationToProtocol', () => {


  it('should return NFS for LIST_NFS_PATHS', () => {
    const result = OperationToProtocol(Operations.LIST_NFS_PATHS);
    expect(result).toBe(Protocol.NFS);
  });

  it('should return NFS for VALIDATE_NFS_CONNECTION', () => {
    const result = OperationToProtocol(Operations.VALIDATE_NFS_CONNECTION);
    expect(result).toBe(Protocol.NFS);
  });


  it('should return SMB for LIST_SMB_PATHS', () => {
    const result = OperationToProtocol(Operations.LIST_SMB_PATHS);
    expect(result).toBe(Protocol.SMB);
  });

  it('should return SMB for VALIDATE_SMB_CONNECTION', () => {
    const result = OperationToProtocol(Operations.VALIDATE_SMB_CONNECTION);
    expect(result).toBe(Protocol.SMB);
  });


  it('should throw an error for an invalid operation', () => {

    const invalidOperation = 'INVALID_OPERATION' as Operations;

    expect(() => OperationToProtocol(invalidOperation)).toThrowError('Invalid Operation');
  });


  it('should throw an error if no operation is provided', () => {
    // @ts-ignore: Test missing operation (undefined)
    expect(() => OperationToProtocol(undefined)).toThrowError('Invalid Operation');
    
    // @ts-ignore: Test null operation
    expect(() => OperationToProtocol(null)).toThrowError('Invalid Operation');
  });

});


describe('operationsTypeToTaskType', () => {
  it('should return TaskType.Scan when OperationType.SCAN is provided', () => {
    const result = operationsTypeToTaskType(OperationType.SCAN);
    expect(result).toBe(TaskType.Scan);
  });

  it('should throw an error for an invalid operation type', () => {
    const invalidOperation = 'INVALID_OPERATION' as OperationType;
    expect(() => operationsTypeToTaskType(invalidOperation)).toThrowError('Invalid Operation');
  });
});

describe('jobTypeToOperationType', () => {
  it('should return OperationType.SCAN when JobType.DISCOVER is provided', () => {
    const result = jobTypeToOperationType(JobType.DISCOVER);
    expect(result).toBe(OperationType.SCAN);
  });

  it('should throw an error for an invalid job type', () => {
    const invalidJobType = 'INVALID_JOB_TYPE' as JobType;
    expect(() => jobTypeToOperationType(invalidJobType)).toThrowError('Invalid Operation');
  });

  it('should throw an error for an unhandled job type', () => {
    const unhandledJobType =''; 
    expect(() => jobTypeToOperationType(unhandledJobType as any)).toThrowError('Invalid Operation');
  });

  describe('nextDate', ()=>{
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

  it('should return the next date parsed from the cron string if jobType is not DISCOVER', () => {
      const mockNextDate = new Date(Date.now() + 1000 * 60 * 60); // 1 hour in the future
      const mockCronExpression = {
          next: jest.fn().mockReturnValue({ toDate: () => mockNextDate }),
      };
      (parser.parseExpression as jest.Mock).mockReturnValue(mockCronExpression);

      const result = nextDate('OTHER_JOB_TYPE', null, '*/5 * * * *');
      expect(parser.parseExpression).toHaveBeenCalledWith('*/5 * * * *');
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

      expect(() => nextDate('OTHER_JOB_TYPE', null, 'invalid-cron')).toThrow('Invalid cron expression');
  });
})
});