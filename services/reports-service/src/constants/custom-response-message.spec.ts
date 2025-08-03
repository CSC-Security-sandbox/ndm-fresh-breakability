import {
  customErrorDTOList,
  customSuccessDTOList,
  HTTPMethod,
} from './custom-response-message';

describe('Custom Response Message', () => {
  describe('HTTPMethod enum', () => {
    it('should define all HTTP methods', () => {
      expect(HTTPMethod.GET).toBe('GET');
      expect(HTTPMethod.POST).toBe('POST');
      expect(HTTPMethod.PUT).toBe('PUT');
      expect(HTTPMethod.PATCH).toBe('PATCH');
      expect(HTTPMethod.DELETE).toBe('DELETE');
    });

    it('should have all expected HTTP method keys', () => {
      const expectedKeys = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
      const actualKeys = Object.keys(HTTPMethod);
      expect(actualKeys).toEqual(expect.arrayContaining(expectedKeys));
      expect(actualKeys.length).toBe(expectedKeys.length);
    });
  });

  describe('customSuccessDTOList', () => {
    it('should be defined as an array', () => {
      expect(customSuccessDTOList).toBeDefined();
      expect(Array.isArray(customSuccessDTOList)).toBe(true);
    });

    it('should be an empty array initially', () => {
      expect(customSuccessDTOList).toEqual([]);
      expect(customSuccessDTOList.length).toBe(0);
    });

    it('should be of correct type', () => {
      // Test that it can hold CustomSuccessDTO objects when populated
      expect(typeof customSuccessDTOList).toBe('object');
      expect(customSuccessDTOList.constructor).toBe(Array);
    });
  });

  describe('customErrorDTOList', () => {
    it('should be defined as an array', () => {
      expect(customErrorDTOList).toBeDefined();
      expect(Array.isArray(customErrorDTOList)).toBe(true);
    });

    it('should be an empty array initially', () => {
      expect(customErrorDTOList).toEqual([]);
      expect(customErrorDTOList.length).toBe(0);
    });

    it('should be of correct type', () => {
      // Test that it can hold CustomErrorDTO objects when populated
      expect(typeof customErrorDTOList).toBe('object');
      expect(customErrorDTOList.constructor).toBe(Array);
    });
  });

  describe('Module exports', () => {
    it('should export all expected constants and enums', () => {
      // Test that all exports are accessible
      expect(HTTPMethod).toBeDefined();
      expect(customSuccessDTOList).toBeDefined();
      expect(customErrorDTOList).toBeDefined();
    });

    it('should have correct export types', () => {
      // HTTPMethod should be an enum (object with string values)
      expect(typeof HTTPMethod).toBe('object');
      
      // Arrays should be arrays
      expect(Array.isArray(customSuccessDTOList)).toBe(true);
      expect(Array.isArray(customErrorDTOList)).toBe(true);
    });
  });
});
