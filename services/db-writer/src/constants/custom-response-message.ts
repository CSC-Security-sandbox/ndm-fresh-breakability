import {
  CustomErrorDTO,
  CustomSuccessDTO,
} from '@netapp-cloud-datamigrate/api-handler-lib';

export enum HTTPMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
}

export const customSuccessDTOList: CustomSuccessDTO[] = [
  {
    apiEndPointKey: 'redis-consumer/start',
    message: 'Consumer started successfully.',
    method: HTTPMethod.POST,
    statusCode: '200',
  },
  {
    apiEndPointKey: 'redis-consumer/stop',
    message: 'Consumer stopped successfully.',
    method: HTTPMethod.POST,
    statusCode: '200',
  },
  {
    apiEndPointKey: 'redis-consumer/status',
    message: 'Consumer status retrieved successfully.',
    method: HTTPMethod.GET,
    statusCode: '200',
  },
  {
    apiEndPointKey: 'health',
    message: 'Service is healthy.',
    method: HTTPMethod.GET,
    statusCode: '200',
  },
];

export const customErrorDTOList: CustomErrorDTO[] = [
  {
    apiEndPointKey: 'redis-consumer/start',
    message: 'Failed to start consumer.',
    statusCode: '500',
  },
  {
    apiEndPointKey: 'redis-consumer/stop',
    message: 'Failed to stop consumer.',
    statusCode: '500',
  },
  {
    apiEndPointKey: 'redis-consumer/status',
    message: 'Failed to retrieve consumer status.',
    statusCode: '500',
  },
  {
    apiEndPointKey: 'health',
    message: 'Service health check failed.',
    statusCode: '500',
  },
  {
    apiEndPointKey: 'redis-consumer/start',
    message: 'Invalid consumer configuration provided.',
    statusCode: '400',
  },
];
