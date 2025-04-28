import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { InternalServerErrorException } from '@nestjs/common';

export async function makeAxiosRequest<T>(
  config: AxiosRequestConfig,
): Promise<T> {
  try {
    const response: AxiosResponse<T> = await axios.request<T>(config);

    if (!response || response.status < 200 || response.status > 299) {
      throw new InternalServerErrorException(
        `Request failed with status code: ${response?.status ?? 'unknown'}`,
      );
    }

    return response.data;
  } catch (error) {
    throw new InternalServerErrorException(
      `Axios request failed error: ${(error as Error).message}`,
    );
  }
}
