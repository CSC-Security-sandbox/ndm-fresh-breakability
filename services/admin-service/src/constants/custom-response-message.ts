import { CustomErrorDTO, CustomSuccessDTO } from '@local/api-handler-lib';

export enum HTTPMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
}

export const successResponse:CustomSuccessDTO[] = [
  {
    apiEndPointKey: 'create-user',
    message: 'User Created successfully.',
    method: HTTPMethod.POST,
    statusCode: '200',
  },
  {
    apiEndPointKey: 'projects',
    message: 'Project created successfully',
    method:  HTTPMethod.POST,
    statusCode: '200',
  },
  {
    apiEndPointKey: 'projects',
    message: 'Project updated successfully',
    method:  HTTPMethod.PATCH,
    statusCode: '200',
  },

  {
    apiEndPointKey: 'batch',
    method: HTTPMethod.POST,
    message: 'Associate Users for the Project has been added/removed successfully',
    statusCode: '200',
  },

];
export const errorResponse:CustomErrorDTO[] = [
  {
    apiEndPointKey: 'batch',
    message: 'Failed to associate the users.',
    statusCode: '500',
  },
  {
    apiEndPointKey: 'projects',
    message: 'failed to create project',
    statusCode: '500',
  },
  {
    apiEndPointKey: 'batch',
    message: 'failed to associate users for the project',
    statusCode: '500',
  },
];