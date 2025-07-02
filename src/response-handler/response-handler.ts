import {
  ApiResponse,
} from './response-interface';
import { Request } from 'express';
import {ErrorCatalog} from '../constants/error';
import {formatDataResponse, setMessage} from '../utils/success-response.utils';
import {CustomErrorDTO, CustomSuccessDTO} from '../config/response-handler.type';
export class ResponseHandler {
  static success<T, request>(data: T, request: Request, successList: Array<CustomSuccessDTO>): ApiResponse<T> {
    const message = setMessage(request, data);
    return {
      trackId: request.get('trackId') as string || '',
      message: message,
      data: formatDataResponse(data),
    };
  }
  static error<T>(data: T,trackId : string, errorList : Array<CustomErrorDTO>): ApiResponse<T> {
    //need to get the api endpoint key and then get the error message from the errorList
    const errorMsg = '' //setMessage(errorList)|| (data as any)?.response?.message ?? ErrorCatalog[data['code']]?.message;
    return {
      trackId: trackId,
      message: errorMsg,
      data: undefined
    };
  }
}
