import {
  customErrorDTOList,
  customSuccessDTOList,
  HTTPMethod,
} from './custom-response-message';

import { SQL_QUERIES } from './custom-response-message';

describe('Custom Response Message', () => {
  describe('HTTPMethod enum', () => {
    it('should define all HTTP methods', () => {
      expect(HTTPMethod.GET).toBe('GET');
      expect(HTTPMethod.POST).toBe('POST');
      expect(HTTPMethod.PUT).toBe('PUT');
      expect(HTTPMethod.PATCH).toBe('PATCH');
      expect(HTTPMethod.DELETE).toBe('DELETE');
    });
  });

  describe('customSuccessDTOList', () => {
    it('should be defined', () => {
      expect(customSuccessDTOList).toBeDefined();
      expect(Array.isArray(customSuccessDTOList)).toBe(true);
    });

    it('should contain success responses for redis-consumer/start', () => {
      const startConsumerResponse = customSuccessDTOList.find(
        (response) => response.apiEndPointKey === 'redis-consumer/start',
      );
      expect(startConsumerResponse).toBeDefined();
      expect(startConsumerResponse.message).toBe('Consumer started successfully.');
      expect(startConsumerResponse.method).toBe(HTTPMethod.POST);
    });

    it('should have valid structure for all success responses', () => {
      customSuccessDTOList.forEach((response) => {
        expect(response).toHaveProperty('apiEndPointKey');
        expect(response).toHaveProperty('message');
        expect(response).toHaveProperty('method');
        expect(typeof response.apiEndPointKey).toBe('string');
        expect(typeof response.message).toBe('string');
        expect(Object.values(HTTPMethod)).toContain(response.method);
      });
    });
  });

  describe('customErrorDTOList', () => {
    it('should be defined', () => {
      expect(customErrorDTOList).toBeDefined();
      expect(Array.isArray(customErrorDTOList)).toBe(true);
    });

    it('should contain error responses for redis-consumer/start', () => {
      const startConsumerError = customErrorDTOList.find(
        (response) => response.apiEndPointKey === 'redis-consumer/start',
      );
      expect(startConsumerError).toBeDefined();
      expect(startConsumerError.message).toBe('Failed to start consumer.');
      expect(startConsumerError.statusCode).toBe('500');
    });

    it('should have valid structure for all error responses', () => {
      customErrorDTOList.forEach((response) => {
        expect(response).toHaveProperty('apiEndPointKey');
        expect(response).toHaveProperty('message');
        expect(response).toHaveProperty('statusCode');
        expect(typeof response.apiEndPointKey).toBe('string');
        expect(typeof response.message).toBe('string');
        expect(typeof response.statusCode).toBe('string');
      });
    });
  });

  describe('Response consistency', () => {
    it('should have corresponding error responses for each success endpoint', () => {
      const successKeys = customSuccessDTOList.map(dto => dto.apiEndPointKey);
      const errorKeys = customErrorDTOList.map(dto => dto.apiEndPointKey);
      
      successKeys.forEach(key => {
        expect(errorKeys).toContain(key);
      });
    });

    it('should have all expected endpoint keys', () => {
      const expectedKeys = [
        'redis-consumer/start',
        ''  // Root health endpoint
      ];
      
      const successKeys = customSuccessDTOList.map(dto => dto.apiEndPointKey);
      expectedKeys.forEach(key => {
        expect(successKeys).toContain(key);
      });
    });

    describe('SQL_QUERIES', () => {
      it('should be defined and have GET_PROJECT_ID_FROM_JOBRUN property', () => {
      expect(SQL_QUERIES).toBeDefined();
      expect(SQL_QUERIES).toHaveProperty('GET_PROJECT_ID_FROM_JOBRUN');
      expect(typeof SQL_QUERIES.GET_PROJECT_ID_FROM_JOBRUN).toBe('string');
      });

      it('GET_PROJECT_ID_FROM_JOBRUN should contain correct SQL structure', () => {
      const query = SQL_QUERIES.GET_PROJECT_ID_FROM_JOBRUN;
      expect(query).toContain('SELECT c.project_id');
      expect(query).toContain('FROM datamigrator.jobrun jr');
      expect(query).toContain('JOIN datamigrator.jobconfig jc ON jr.job_config_id = jc.id');
      expect(query).toContain('JOIN datamigrator.volume v ON jc.source_path_id = v.id');
      expect(query).toContain('JOIN datamigrator.file_server fs ON v.file_server_id = fs.id');
      expect(query).toContain('JOIN datamigrator.config c ON fs.config_id = c.id');
      expect(query).toContain('WHERE jr.id = $1');
      });
    });
  });
});
