import { getErrorDisplayMessage } from "./jobrun.utli";

describe('JobRun Utils', () => {

  describe('getErrorDisplayMessage', () => {
    const mockSystemMessage = 'Database connection timeout after 30 seconds';
    const mockRemedyDescription = 'Check database connectivity and retry the operation';

    describe('General Error Codes', () => {
      const generalErrorCodes = [
        'OP_GENERAL_FAILURE',
        'TASK_GENERAL_FAILURE',
        'OP_UNKNOWN_ERROR',
        'TASK_UNKNOWN_ERROR'
      ];

      generalErrorCodes.forEach(errorCode => {
        describe(`${errorCode}`, () => {
          it('should return system message when remedy is provided and system message exists', () => {
            const result = getErrorDisplayMessage(errorCode, mockSystemMessage, mockRemedyDescription);
            expect(result).toBe(mockSystemMessage);
          });

          it('should return remedy when system message is empty', () => {
            const result = getErrorDisplayMessage(errorCode, '', mockRemedyDescription);
            expect(result).toBe(mockRemedyDescription);
          });

          it('should return remedy when system message is null/undefined', () => {
            const result1 = getErrorDisplayMessage(errorCode, null as any, mockRemedyDescription);
            const result2 = getErrorDisplayMessage(errorCode, undefined as any, mockRemedyDescription);
            expect(result1).toBe(mockRemedyDescription);
            expect(result2).toBe(mockRemedyDescription);
          });

          it('should return system message when no remedy is provided', () => {
            const result = getErrorDisplayMessage(errorCode, mockSystemMessage);
            expect(result).toBe(mockSystemMessage);
          });

          it('should return system message when remedy is empty string', () => {
            const result = getErrorDisplayMessage(errorCode, mockSystemMessage, '');
            expect(result).toBe(mockSystemMessage);
          });
        });
      });
    });

    describe('Specific Error Codes', () => {
      const specificErrorCodes = [
        'OP_NO_SPACE_LEFT',
        'TASK_FILE_NOT_FOUND',
        'OP_PERMISSION_DENIED',
        'TASK_NETWORK_ERROR'
      ];

      specificErrorCodes.forEach(errorCode => {
        describe(`${errorCode}`, () => {
          it('should return remedy description when remedy is provided', () => {
            const result = getErrorDisplayMessage(errorCode, mockSystemMessage, mockRemedyDescription);
            expect(result).toBe(mockRemedyDescription);
          });

          it('should return system message when no remedy is provided', () => {
            const result = getErrorDisplayMessage(errorCode, mockSystemMessage);
            expect(result).toBe(mockSystemMessage);
          });

          it('should return remedy when system message is empty but remedy exists', () => {
            const result = getErrorDisplayMessage(errorCode, '', mockRemedyDescription);
            expect(result).toBe(mockRemedyDescription);
          });
        });
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty error code with remedy', () => {
        const result = getErrorDisplayMessage('', mockSystemMessage, mockRemedyDescription);
        expect(result).toBe(mockRemedyDescription);
      });

      it('should handle empty error code without remedy', () => {
        const result = getErrorDisplayMessage('', mockSystemMessage);
        expect(result).toBe(mockSystemMessage);
      });

      it('should handle undefined/null error code', () => {
        const result1 = getErrorDisplayMessage(null as any, mockSystemMessage, mockRemedyDescription);
        const result2 = getErrorDisplayMessage(undefined as any, mockSystemMessage, mockRemedyDescription);
        expect(result1).toBe(mockRemedyDescription);
        expect(result2).toBe(mockRemedyDescription);
      });

      it('should handle all empty/null/undefined parameters', () => {
        const result = getErrorDisplayMessage('', '', '');
        expect(result).toBe('');
      });

      it('should handle whitespace-only strings', () => {
        const result = getErrorDisplayMessage('  ', '  ', '  ');
        expect(result).toBe('  '); // Should return the whitespace system message
      });

      it('should handle very long strings', () => {
        const longSystemMessage = 'A'.repeat(1000);
        const longRemedyDescription = 'B'.repeat(1000);
        const result = getErrorDisplayMessage('OP_GENERAL_FAILURE', longSystemMessage, longRemedyDescription);
        expect(result).toBe(longSystemMessage);
        expect(result.length).toBe(1000);
      });

      it('should handle special characters in messages', () => {
        const specialSystemMessage = 'Error: 💥 Database "test_db" connection failed! @#$%^&*()';
        const specialRemedyDescription = 'Solution: 🔧 Check config.json & restart service 🚀';
        const result = getErrorDisplayMessage('OP_NO_SPACE_LEFT', specialSystemMessage, specialRemedyDescription);
        expect(result).toBe(specialRemedyDescription);
      });
    });

    describe('Type Validation', () => {
      it('should accept valid string parameters', () => {
        expect(() => {
          getErrorDisplayMessage('OP_GENERAL_FAILURE', 'message', 'remedy');
        }).not.toThrow();
      });

      it('should work with numeric strings', () => {
        const result = getErrorDisplayMessage('123', '456', '789');
        expect(result).toBe('789');
      });
    });
  });
});