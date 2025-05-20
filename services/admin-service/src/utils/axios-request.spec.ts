import axios from 'axios';
import { InternalServerErrorException } from '@nestjs/common';
import { makeAxiosRequest } from './axios-request-utils';

jest.mock('axios');

describe('makeAxiosRequest', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return data when request is successful', async () => {
    const mockData = { message: 'Success' };
    const mockResponse = {
      data: mockData,
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {},
    };

    mockedAxios.request.mockResolvedValueOnce(mockResponse);

    const config = { url: '/test', method: 'GET' };

    const result = await makeAxiosRequest(config);

    expect(result).toEqual(mockData);
    expect(mockedAxios.request).toHaveBeenCalledWith(config);
  });

  it('should throw an exception when response status is not 2xx', async () => {
    const mockResponse = {
      data: {},
      status: 400,
      statusText: 'Bad Request',
      headers: {},
      config: {},
    };

    mockedAxios.request.mockResolvedValueOnce(mockResponse);

    const config = { url: '/test', method: 'GET' };

    await expect(makeAxiosRequest(config)).rejects.toThrow(
      new InternalServerErrorException(
        'Axios request failed error: Request failed with status code: 400',
      ),
    );
    expect(mockedAxios.request).toHaveBeenCalledWith(config);
  });

  it('should throw an exception when Axios request fails', async () => {
    mockedAxios.request.mockRejectedValueOnce(new Error('Network Error'));

    const config = { url: '/test', method: 'GET' };

    await expect(makeAxiosRequest(config)).rejects.toThrow(
      new InternalServerErrorException(
        'Axios request failed error: Network Error',
      ),
    );
    expect(mockedAxios.request).toHaveBeenCalledWith(config);
  });
});
