import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { InternalServerErrorException } from "@nestjs/common";

export async function makeAxiosRequest<T>(
  config: AxiosRequestConfig
): Promise<T> {
  try {
    const response: AxiosResponse<T> = await axios(config);

    if (response.status < 199 && response.status > 300) {
      throw new InternalServerErrorException(
        `Request failed with response: ${response}`
      );
    }

    return response.data;
  } catch (error) {
    throw new InternalServerErrorException(
      `Axios request failed error: ${error}`
    );
  }
}