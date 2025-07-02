import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, map, throwError } from 'rxjs';
import { Request, Response } from 'express';
import { ResponseHandler } from './response-handler';
import {ErrorHTTPStatusMappingCode} from '../constants/error';
import {CustomErrorDTO, CustomSuccessDTO} from '../config/response-handler.type';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, any> {
  successList : Array<CustomSuccessDTO>;
    errorList : Array<CustomErrorDTO>;
  constructor(
      successList:Array<CustomSuccessDTO>,
      errorList:Array<CustomErrorDTO>) {
    this.successList = successList;
    this.errorList = errorList;

  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse<Response<any>>();
    const request = ctx.getRequest<Request>();

    return next.handle().pipe(
      map((data) => {
        return ResponseHandler.success(data, request,this.successList);
      }),
      catchError((err) => {
        let statusCode =
          err?.response?.statusCode || ErrorHTTPStatusMappingCode[err.code] || 500;
      const trackId= request.get('trackId') as string || '';
        const errorResponse = ResponseHandler.error(err, trackId, this.errorList);
        response.status(statusCode).json(errorResponse);
        return throwError(() => response); // Optional: rethrow if needed for logging
      }),
    );
  }
}
