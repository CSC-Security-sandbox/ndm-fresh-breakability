import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, catchError, map, throwError } from "rxjs";
import { Request, Response } from "express";
import { ResponseHandler } from "./response-handler";

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, any> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse<Response<any>>();
    const request = ctx.getRequest<Request>();
    //console.log('Request log on the response interceptor', request);

    return next.handle().pipe(
      map((data) => {
        return ResponseHandler.success(data, "Request successful");
      }),
      catchError((err) => {
        const message = err.message || "Internal server error";
        // write code for corrective actions
        const errorResponse = ResponseHandler.error(message, err.response);
        response.status(err.response.statusCode).json(errorResponse);
        return throwError(() => response); // Optional: rethrow if needed for logging
      }),
    );
  }
}
