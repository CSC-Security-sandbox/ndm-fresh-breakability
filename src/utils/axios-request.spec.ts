import axios from 'axios';
import { InternalServerErrorException } from '@nestjs/common';
import { makeAxiosRequest } from './axios-request-utils';
 
// Mock the entire axios module
jest.mock('axios');
 
describe('makeAxiosRequest', () => {
  const mockedAxios = axios as jest.Mocked<typeof axios>;
 
  // Test for successful request
  it('should return data when request is successful', async () => {
    const mockData = { message: 'Success' };
    const mockResponse = { data: mockData, status: 200 };
    // Mock axios to resolve with the mock response
    mockedAxios.request.mockResolvedValue(mockResponse);
 
    const config = { url: '/test', method: 'GET' };
 
    // Call the function and check the result
    const result = await makeAxiosRequest(config);
    expect(result).toEqual(mockData); // Check if the result matches the mock data
    expect(mockedAxios.request).toHaveBeenCalledWith(config); // Ensure axios was called with correct config
  });
 
  // Test for unsuccessful response (non-2xx status code)
  it('should throw InternalServerErrorException when response status is not 2xx', async () => {
    const mockResponse = { data: {}, status: 400 };
    // Mock axios to resolve with an unsuccessful status
    mockedAxios.request.mockResolvedValue(mockResponse);
 
    const config = { url: '/test', method: 'GET' };
 
    // Expect an error to be thrown
    await expect(makeAxiosRequest(config)).rejects.toThrowError(
      new InternalServerErrorException('Request failed with status code: 400')
    );
  });
 
  // Test for Axios request failure (network error, timeout, etc.)
  it('should throw InternalServerErrorException when Axios throws an error', async () => {
    const mockError = new Error('Network Error');
    // Mock axios to reject with an error
    mockedAxios.request.mockRejectedValue(mockError);
 
    const config = { url: '/test', method: 'GET' };
 
    // Expect an error to be thrown
    await expect(makeAxiosRequest(config)).rejects.toThrowError(
      new InternalServerErrorException('Axios request failed: Network Error')
    );
  });
});