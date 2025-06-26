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
    return next.handle().pipe(
      map((data) => {
        return ResponseHandler.success(data, request.route.path);
      }),
      catchError((err) => {
        const errorResponse = ResponseHandler.error(err);
        response.status(err.response.statusCode).json(errorResponse);
        return throwError(() => response); // Optional: rethrow if needed for logging
      }),
    );
  }
}
