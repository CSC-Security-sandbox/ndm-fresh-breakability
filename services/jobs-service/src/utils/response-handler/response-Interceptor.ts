import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, map, throwError } from 'rxjs';
import { Request, Response } from 'express';
import { ResponseHandler } from './response-handler';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, any> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse<Response<any>>();
    const request = ctx.getRequest<Request>();
    //console.log('Request log on the response interceptor', request);
    return next.handle().pipe(
      map((data) => {
        console.log('ResponseInterceptor>>>>>>>>>>',data);
        return ResponseHandler.success(data, 'Request successful');
      }),
      catchError((err) => {
        console.log('Error caught in response interceptor:', err);
        const statusCode = err.status || 500;
        const message = err.message || 'Internal server error';
        const errorResponse = ResponseHandler.error(message, err, statusCode);
        response.status(statusCode).json(errorResponse);
        return throwError(() => response); // Optional: rethrow if needed for logging
      }),
      /* {

         const statusCode = err.status || 500;
         const message = err.message || 'Internal server error';
         const errorResponse = ResponseHandler.error(message, err, statusCode);

         response.status(statusCode).json(errorResponse);
         return throwError(() => err); // Optional: rethrow if needed for logging
       }),*/
    );
  }
}
