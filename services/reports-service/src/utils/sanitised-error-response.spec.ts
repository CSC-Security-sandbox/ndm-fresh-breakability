import { sanitisedeErrorResponse } from './sanitised-error-response';

describe('sanitisedeErrorResponse', () => {
  it('should return sanitized error response with default values when error is empty', () => {
    const error = {};
    const result = sanitisedeErrorResponse(error);
    expect(result).toEqual({
      response: 'An unexpected error occurred. Please try again later.',
      status: 500,
      message: 'An unexpected error occurred. Please try again later.',
      name: 'Error',
    });
  });

  it('should return sanitized error response with provided values', () => {
    const error = {
      response: 'Custom response',
      status: 404,
      message: 'Custom message',
      name: 'CustomError',
    };
    const result = sanitisedeErrorResponse(error);
    expect(result).toEqual({
      response: 'Custom response',
      status: 404,
      message: 'Custom message',
      name: 'CustomError',
    });
  });

  it('should handle missing fields in the error object gracefully', () => {
    const error = {
      response: 'Partial response',
    };
    const result = sanitisedeErrorResponse(error);
    expect(result).toEqual({
      response: 'Partial response',
      status: 500,
      message: 'An unexpected error occurred. Please try again later.',
      name: 'Error',
    });
  });

  it('should handle null values in the error object gracefully', () => {
    const error = {
      response: null,
      status: null,
      message: null,
      name: null,
    };
    const result = sanitisedeErrorResponse(error);
    expect(result).toEqual({
      response: 'An unexpected error occurred. Please try again later.',
      status: 500,
      message: 'An unexpected error occurred. Please try again later.',
      name: 'Error',
    });
  });

  it('should handle undefined values in the error object gracefully', () => {
    const error = {
      response: undefined,
      status: undefined,
      message: undefined,
      name: undefined,
    };
    const result = sanitisedeErrorResponse(error);
    expect(result).toEqual({
      response: 'An unexpected error occurred. Please try again later.',
      status: 500,
      message: 'An unexpected error occurred. Please try again later.',
      name: 'Error',
    });
  });
});