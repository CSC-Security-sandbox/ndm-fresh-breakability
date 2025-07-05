import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, map, throwError } from 'rxjs';
import { Request, Response } from 'express';
import { ResponseHandler } from './response-handler';
import {CustomErrorDTO} from '../dto/custom-error-dto';
import {CustomSuccessDTO} from '../dto/custom-success-dto';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, any> {
  constructor(
      private readonly successDTOList: CustomSuccessDTO[],
      private readonly errorDTOList: CustomErrorDTO[],
) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse<Response<any>>();
    const request = ctx.getRequest<Request>();
    console.log('request', request['trackId'],response['trackId']);
    return next.handle().pipe(
        map((data) => {
          const result = ResponseHandler.success(request, data, this.successDTOList);
          response.status(result.statusCode);
          console.log('final Result',result);
          result.data.trackId = request['trackId'];
          return result.data;
        }),
      catchError((err) => {
        const errorResponse = ResponseHandler.error(request,err, this.errorDTOList);
          errorResponse.data.trackId = request['trackId'];
            response.status(errorResponse.statusCode).json(errorResponse.data);
        return throwError(() => errorResponse.data); // Return error data instead of response object
      }),
    );
  }
}
