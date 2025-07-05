
import { HTTPMethod, customSuccessDTOList, customErrorDTOList } from './custom-response-message';

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

    it('should contain success responses for create-user', () => {
      const createUserResponse = customSuccessDTOList.find(
        (response) => response.apiEndPointKey === 'create-user'
      );
      expect(createUserResponse).toBeDefined();
      expect(createUserResponse.message).toBe('User Created successfully.');
      expect(createUserResponse.method).toBe(HTTPMethod.POST);
      expect(createUserResponse.statusCode).toBe('200');
    });

    it('should contain success responses for projects', () => {
      const projectResponses = customSuccessDTOList.filter(
        (response) => response.apiEndPointKey === 'projects'
      );
      expect(projectResponses.length).toBeGreaterThan(0);

      const createProjectResponse = projectResponses.find(
        (response) => response.method === HTTPMethod.POST
      );
      expect(createProjectResponse).toBeDefined();
      expect(createProjectResponse.message).toBe('Project created successfully');
      expect(createProjectResponse.statusCode).toBe('200');

      const updateProjectResponse = projectResponses.find(
        (response) => response.method === HTTPMethod.PATCH
      );
      expect(updateProjectResponse).toBeDefined();
      expect(updateProjectResponse.message).toBe('Project updated successfully');
      expect(updateProjectResponse.statusCode).toBe('200');
    });

    it('should contain success responses for batch', () => {
      const batchResponse = customSuccessDTOList.find(
        (response) => response.apiEndPointKey === 'batch'
      );
      expect(batchResponse).toBeDefined();
      expect(batchResponse.message).toBe('Users for the Project has been added/removed successfully');
      expect(batchResponse.method).toBe(HTTPMethod.POST);
      expect(batchResponse.statusCode).toBe('200');
    });
  });

  describe('errorResponse', () => {
    it('should be defined', () => {
      expect(customErrorDTOList).toBeDefined();
      expect(Array.isArray(customErrorDTOList)).toBe(true);
    });

    it('should contain error responses for batch', () => {
      const batchErrors = customErrorDTOList.filter(
        (response) => response.apiEndPointKey === 'batch'
      );
      expect(batchErrors.length).toBeGreaterThan(0);

      const associateUsersError = batchErrors.find(
        (response) => response.message === 'Failed to associate the users.'
      );
      expect(associateUsersError).toBeDefined();
      expect(associateUsersError.statusCode).toBe('500');

      const failedToAssociateError = batchErrors.find(
        (response) => response.message === 'Failed to associate users for the project'
      );
      expect(failedToAssociateError).toBeDefined();
      expect(failedToAssociateError.statusCode).toBe('500');
    });

    it('should contain error responses for projects', () => {
      const projectError = customErrorDTOList.find(
        (response) => response.apiEndPointKey === 'projects'
      );
      expect(projectError).toBeDefined();
      expect(projectError.message).toBe('Failed to create project');
      expect(projectError.statusCode).toBe('500');
    });
  });
});
