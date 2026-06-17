import {
    CallHandler,
    ExecutionContext,
    Injectable,
    NestInterceptor,
    Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Observable, catchError, map, throwError } from 'rxjs';
import { Request, Response } from 'express';
import { ResponseHandler } from './response-handler';
import {CustomErrorDTO} from '../dto/custom-error-dto';
import {CustomSuccessDTO} from '../dto/custom-success-dto';
import {LoggerFactory, LoggerService} from "@netapp-cloud-datamigrate/logger-lib";

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, any> {
    private readonly logger: LoggerService;
    private readonly reflector: Reflector;
    constructor(
      private readonly successDTOList: CustomSuccessDTO[],
      private readonly errorDTOList: CustomErrorDTO[],
      @Inject(LoggerFactory) loggerFactory: LoggerFactory,
      reflector?: Reflector,
) {
        this.logger = loggerFactory.create(ResponseInterceptor.name);
        this.reflector = reflector ?? new Reflector();
    }
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const httpArgumentsHost = context.switchToHttp();
    const response = httpArgumentsHost.getResponse<Response<any>>();
    const request = httpArgumentsHost.getRequest<Request>();

    const customHttpCode = this.reflector.get<number>(
      HTTP_CODE_METADATA,
      context.getHandler(),
    );

    return next.handle().pipe(
        map((controllerResponse) => {
          const result = ResponseHandler.success(request, controllerResponse, this.successDTOList);
          const statusCode = customHttpCode ?? result.statusCode;
          response.status(statusCode);
          result.data.trackId = request['trackId'];
          this.logger.log(`Final response from interceptor \n JSON.stringify(${result})`);
          return result.data;
        }),
      catchError((err) => {
        const errorResponse = ResponseHandler.error(request,err, this.errorDTOList, this.logger);
          errorResponse.data.trackId = request['trackId'];
            response.status(errorResponse.statusCode).json(errorResponse.data);
        return throwError(() => errorResponse.data);
      }),
    );
  }
}
