import {
    CallHandler,
    ExecutionContext,
    Injectable,
    NestInterceptor,
    Inject,
} from '@nestjs/common';
import { Observable, catchError, map, throwError } from 'rxjs';
import { Request, Response } from 'express';
import { ResponseHandler } from './response-handler';
import {CustomErrorDTO} from '../dto/custom-error-dto';
import {CustomSuccessDTO} from '../dto/custom-success-dto';
import {LoggerFactory, LoggerService} from "@netapp-cloud-datamigrate/logger-lib";

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, any> {
    private readonly logger: LoggerService;
    constructor(
      private readonly successDTOList: CustomSuccessDTO[],
      private readonly errorDTOList: CustomErrorDTO[],
      @Inject(LoggerFactory) loggerFactory: LoggerFactory,
) {
        this.logger = loggerFactory.create(ResponseInterceptor.name);
    }
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const httpArgumentsHost = context.switchToHttp();
    const response = httpArgumentsHost.getResponse<Response<any>>();
    const request = httpArgumentsHost.getRequest<Request>();
    return next.handle().pipe(
        map((controllerResponse) => {
          const result = ResponseHandler.success(request, controllerResponse, this.successDTOList, this.logger);
          response.status(result.statusCode);
          result.data.trackId = request['trackId'];
          this.logger.log(`Final response from interceptor \n JSON.stringify(${result})`);
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
