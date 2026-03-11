import { getErrorDisplayMessage, getWorkflowId } from './jobrun.util';
import { JobType, WorkFlows } from 'src/constants/enums';

describe('JobRun Utils', () => {
  describe('getWorkflowId', () => {
    it('should return the workflow ID for DISCOVER job type', () => {
      const jobRunId = 'jobRunId';
      const result = getWorkflowId(jobRunId, JobType.DISCOVER);
      expect(result).toEqual(`${WorkFlows.DISCOVERY}-${jobRunId}`);
    });

    it('should return the workflow ID for CUT_OVER job type', () => {
      const jobRunId = 'jobRunId';
      const result = getWorkflowId(jobRunId, JobType.CUT_OVER);
      expect(result).toEqual(`${WorkFlows.CUT_OVER}-${jobRunId}`);
    });

    it('should return the workflow ID for MIGRATE job type', () => {
      const jobRunId = 'jobRunId';
      const result = getWorkflowId(jobRunId, JobType.MIGRATE);
      expect(result).toEqual(`${WorkFlows.MIGRATE}-${jobRunId}`);
    });

    it('should return the workflow ID for SPEED_TEST job type', () => {
      const jobRunId = 'jobRunId';
      const result = getWorkflowId(jobRunId, JobType.SPEED_TEST);
      expect(result).toEqual(`${WorkFlows.SPEED_TEST}-${jobRunId}`);
    });
  });

  describe('getErrorDisplayMessage', () => {
    const mockSystemMessage = 'Database connection timeout after 30 seconds';
    const mockRemedyDescription =
      'Check database connectivity and retry the operation';

    describe('General Error Codes', () => {
      const generalErrorCodes = [
        'OP_GENERAL_FAILURE',
        'TASK_GENERAL_FAILURE',
        'OP_UNKNOWN_ERROR',
        'TASK_UNKNOWN_ERROR',
      ];

      generalErrorCodes.forEach((errorCode) => {
        describe(`${errorCode}`, () => {
          it('should return system message when remedy is provided and system message exists', () => {
            const result = getErrorDisplayMessage(
              errorCode,
              mockSystemMessage,
              mockRemedyDescription,
            );
            expect(result).toBe(mockSystemMessage);
          });

          it('should return remedy when remedy is provided and system message is empty/null/undefined', () => {
            const result1 = getErrorDisplayMessage(
              errorCode,
              '',
              mockRemedyDescription,
            );
            const result2 = getErrorDisplayMessage(
              errorCode,
              null as any,
              mockRemedyDescription,
            );
            const result3 = getErrorDisplayMessage(
              errorCode,
              undefined as any,
              mockRemedyDescription,
            );
            expect(result1).toBe(mockRemedyDescription);
            expect(result2).toBe(mockRemedyDescription);
            expect(result3).toBe(mockRemedyDescription);
          });

          it('should return system message when remedy is not provided/empty string', () => {
            const result1 = getErrorDisplayMessage(
              errorCode,
              mockSystemMessage,
            );
            const result2 = getErrorDisplayMessage(
              errorCode,
              mockSystemMessage,
              '',
            );
            expect(result1).toBe(mockSystemMessage);
            expect(result2).toBe(mockSystemMessage);
          });
        });
      });
    });

    describe('Specific Error Codes', () => {
      const specificErrorCodes = ['OP_NO_SPACE_LEFT', 'TASK_CASE_CONFLICT'];

      specificErrorCodes.forEach((errorCode) => {
        describe(`${errorCode}`, () => {
          it('should return system message when remedy is provided', () => {
            const result = getErrorDisplayMessage(
              errorCode,
              mockSystemMessage,
              mockRemedyDescription,
            );
            expect(result).toBe(mockSystemMessage);
          });

          it('should return system message when remedy is not provided', () => {
            const result = getErrorDisplayMessage(errorCode, mockSystemMessage);
            expect(result).toBe(mockSystemMessage);
          });
        });
      });
    });

    describe('Edge Cases', () => {
      it('should handle long strings in error message and remedy', () => {
        const longSystemMessage = 'A'.repeat(1000);
        const longRemedyDescription = 'B'.repeat(1000);
        const result = getErrorDisplayMessage(
          'OP_GENERAL_FAILURE',
          longSystemMessage,
          longRemedyDescription,
        );
        expect(result).toBe(longSystemMessage);
        expect(result.length).toBe(1000);
      });

      it('should handle special characters in error message and remedy', () => {
        const specialSystemMessage =
          'Error: 💥 Database "test_db" connection failed! @#$%^&*()';
        const specialRemedyDescription =
          'Solution: 🔧 Check config.json & restart service 🚀';
        const result = getErrorDisplayMessage(
          'OP_NO_SPACE_LEFT',
          specialSystemMessage,
          specialRemedyDescription,
        );
        expect(result).toBe(specialSystemMessage);
      });
    });
  });
});
