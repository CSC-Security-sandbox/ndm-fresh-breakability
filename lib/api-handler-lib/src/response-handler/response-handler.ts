import {
  ApiResponse,
} from './response-interface';
import { Request } from 'express';
import {formatResponseData, setErrorMessage, setSuccessMessage} from '../utils/response.utils';
import {ErrorHTTPStatusCodeMapping} from '../constants/error';
import {CustomSuccessDTO} from '../dto/custom-success-dto';
import {CustomErrorDTO} from '../dto/custom-error-dto';
import { LoggerService } from '@netapp-cloud-datamigrate/logger-lib';
export interface HandlerResponse<T> {
    statusCode:number;
    data: ApiResponse<T>;
}

export class ResponseHandler {

  /**
   * Handles successful responses by formatting the response data and setting a success message.
   * @param request - The HTTP request object.
   * @param responseData - The data to be included in the response.
   * @param customSuccessDTOList - List of custom success DTOs to map API endpoints to messages.
   * @returns A structured success response with status code, message, and data.
   */
  static success<T>(request: Request, controllerResponseData: T, customSuccessDTOList: CustomSuccessDTO[], logger: LoggerService): HandlerResponse<T> {
    
    const message = setSuccessMessage(request, controllerResponseData, customSuccessDTOList, logger);
    const formatedResponse = formatResponseData(controllerResponseData);
    return {
      statusCode: 200,
      data: {
        trackId: request['trackId'] as string || '',
        message: message,
        data: formatedResponse
      }
    };
  }

  /**
   * Handles error responses by extracting the error code and message.
   * @param request - The HTTP request object.
   * @param errorResponse - The error response object containing error details.
   * @param errorDTOList - List of custom error DTOs to map error codes to messages.
   * @returns A structured error response with status code and message.
   */
  static error<T>(request :Request,errorResponse:any, errorDTOList : CustomErrorDTO[], logger: LoggerService): HandlerResponse<T> {
    //need to get the api endpoint key and then get the error message from the errorList
    logger.log(`errorResponse \n ${JSON.stringify(errorResponse)}`);
    const errorCode = errorResponse?.status || errorResponse?.statusCode ||errorResponse?.code;
    const statusCode = errorResponse?.status  ||  ErrorHTTPStatusCodeMapping[errorCode] || 500;
    return {
      statusCode,
      data: {
        trackId :request['trackId'] as string || '',
        message: setErrorMessage(request, errorResponse, errorDTOList),
        data: undefined,
        error: errorResponse.response || errorResponse.data
      }
      };
    }
}
