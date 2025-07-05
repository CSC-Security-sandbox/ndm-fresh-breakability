import {
  ApiResponse,
} from './response-interface';
import { Request } from 'express';
import {formatResponseData, setErrorMessage, setSuccessMessage} from '../utils/response.utils';
import {ErrorHTTPStatusMappingCode} from '../constants/error';
import {CustomSuccessDTO} from '../dto/custom-success-dto';
import {CustomErrorDTO} from '../dto/custom-error-dto';
export interface HandlerResponse<T> {
    statusCode:number;
    data: ApiResponse<T>;
}

export class ResponseHandler {
  static success<T>(request: Request, responseData: T, customSuccessDTOList: CustomSuccessDTO[]): HandlerResponse<T> {
    const message = setSuccessMessage(request, responseData, customSuccessDTOList);
    const formateResponse = formatResponseData(responseData);
    return {
      statusCode: 200,
      data: {
        trackId: request['trackId'] as string || '',
        message: message,
        data: formateResponse
      }
    };
  }
  static error<T>(request :Request,errorResponse:any, errorDTOList : CustomErrorDTO[]): HandlerResponse<T> {
    //need to get the api endpoint key and then get the error message from the errorList
    console.log('errorResponse', errorResponse.code ,errorResponse?.status,errorResponse.statusCode);
    const errorCode = errorResponse?.status || errorResponse.statusCode ||errorResponse.code ;
    const statusCode = errorResponse?.status  ||  ErrorHTTPStatusMappingCode[errorCode] || 500;
    console.log('ErrorHTTPStatusMappingCode[errorCode]>>>>',ErrorHTTPStatusMappingCode[errorCode],errorCode)
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
