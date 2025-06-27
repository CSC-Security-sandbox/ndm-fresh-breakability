import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, map, throwError } from 'rxjs';
import { Request, Response } from 'express';
import { ResponseHandler } from './response-handler';
import { HTTPStatusCode } from './response-interface';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, any> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse<Response<any>>();
    const request = ctx.getRequest<Request>();

    return next.handle().pipe(
      map((data) => {
        // console.log('Responseee', request.method);
        return ResponseHandler.success(data, request);
      }),
      catchError((err) => {
        let statusCode =
          err?.response?.statusCode || HTTPStatusCode[err.code] || 500;
        console.log(
          'Error in ResponseInterceptor:',
          err.response,
          err.statusCode,
          err.status,
          err.message,
        );
        const errorResponse = ResponseHandler.error(err);
        response.status(statusCode).json(errorResponse);
        return throwError(() => response); // Optional: rethrow if needed for logging
      }),
    );
  }
}
