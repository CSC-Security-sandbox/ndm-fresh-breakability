import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Inject,
} from '@nestjs/common';
import { Observable, catchError, map, throwError } from 'rxjs';
import { Request, Response } from 'express';
import { Reflector } from '@nestjs/core';
import { CustomErrorDTO, CustomSuccessDTO } from '@netapp-cloud-datamigrate/api-handler-lib';
import { ResponseHandler } from '@netapp-cloud-datamigrate/api-handler-lib/dist/response-handler/response-handler';
import { LoggerFactory, LoggerService } from "@netapp-cloud-datamigrate/logger-lib";
import { SKIP_RESPONSE_TRANSFORM_KEY } from '../decorators/skip-response-transform.decorator';

@Injectable()
export class CustomResponseInterceptor<T> implements NestInterceptor<T, any> {
  private readonly logger: LoggerService;
  
  constructor(
    private readonly successDTOList: CustomSuccessDTO[],
    private readonly errorDTOList: CustomErrorDTO[],
    private readonly reflector: Reflector,
    @Inject(LoggerFactory) loggerFactory: LoggerFactory,
  ) {
    this.logger = loggerFactory.create(CustomResponseInterceptor.name);
  }
  
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const httpArgumentsHost = context.switchToHttp();
    const response = httpArgumentsHost.getResponse<Response<any>>();
    const request = httpArgumentsHost.getRequest<Request>();
    
    // Check if we should skip response transformation
    const skipTransform = this.reflector.getAllAndOverride<boolean>(
      SKIP_RESPONSE_TRANSFORM_KEY,
      [context.getHandler(), context.getClass()],
    );
    
    if (skipTransform) {
      // Skip transformation for binary/file downloads
      return next.handle();
    }
    
    return next.handle().pipe(
      map((controllerResponse) => {
        const result = ResponseHandler.success(request, controllerResponse, this.successDTOList);
        response.status(result.statusCode);
        result.data.trackId = request['trackId'];
        
        // Log response details safely
        this.logger.log(`Final response from interceptor - Status: ${result.statusCode}, Method: ${request.method}, URL: ${request.url}`);
        
        return result.data;
      }),
      catchError((err) => {
        const errorResponse = ResponseHandler.error(request, err, this.errorDTOList, this.logger);
        errorResponse.data.trackId = request['trackId'];
        response.status(errorResponse.statusCode).json(errorResponse.data);
        return throwError(() => errorResponse.data);
      }),
    );
  }
}