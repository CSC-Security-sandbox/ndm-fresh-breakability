import { ResponseInterceptor } from './response-interceptor';
import { ResponseHandler } from './response-handler';
import { HTTPStatusCode } from './response-interface';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, throwError } from 'rxjs';

describe('ResponseInterceptor', () => {
  let interceptor: ResponseInterceptor<any>;
  let mockContext: Partial<ExecutionContext>;
  let mockResponse: any;
  let mockRequest: any;

  beforeEach(() => {
    interceptor = new ResponseInterceptor();
    mockRequest = {};
    mockResponse = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    mockContext = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
        getNext: () => ({}), // Add this line to satisfy the interface
      }),
    } as any;

  });

  it('should call ResponseHandler.success on success', (done) => {
    const data = {
      "message": "Request Processed Successfully",
      "data": {
        "id": "123",
        "items": {
          "roles": [
            {
              "role_name": "App Admin",
              "projects": [],
              "permissions": [
                "AgentDeployment",
                "CreateUser",
                "DeleteProject",
                "DeleteUser",
                "InviteUser",
                "ListUsers",
                "ManageConfig",
                "ManageJob",
                "ManageProject",
                "Reports",
                "RollbackJob",
                "UpdateProject",
                "UpdateUser",
                "ViewAgentsList",
                "ViewConfig",
                "ViewJob",
                "ViewLogs",
                "ViewProject"
              ]
            }
          ]
        }
      }
    }
    const successSpy = jest.spyOn(ResponseHandler, 'success').mockReturnValue(data);

    const callHandler: CallHandler = {
      handle: () => of(data),
    } as any;

    interceptor.intercept(mockContext as ExecutionContext, callHandler).subscribe((result) => {
      expect(successSpy).toHaveBeenCalledWith(data, mockRequest);
      expect(result).toEqual(data);
      done();
    });
  });

  it('should handle error and call ResponseHandler.error', (done) => {
    const error = { response :{statusCode :400} , displayMessage: 'BAD_REQUEST' };

    const errorSpy = jest.spyOn(ResponseHandler, 'error').mockReturnValue({ message :'BAD_REQUEST', error});

    const callHandler: CallHandler = {
      handle: () => throwError(() => error),
    } as any;

    interceptor.intercept(mockContext as ExecutionContext, callHandler).subscribe({
      error: (res) => {
        expect(errorSpy).toHaveBeenCalledWith(error);
        expect(mockResponse.status).toHaveBeenCalledWith(400);
        expect(mockResponse.json).toHaveBeenCalledWith({ message :'BAD_REQUEST', error});
        done();
      },
    });
  });
  it('should handle error and call ResponseHandler.error', (done) => {
    const error = {  code:'22P02', displayMessage: 'BAD_REQUEST' };

    const errorSpy = jest.spyOn(ResponseHandler, 'error').mockReturnValue({ message :'BAD_REQUEST', error});

    const callHandler: CallHandler = {
      handle: () => throwError(() => error),
    } as any;

    interceptor.intercept(mockContext as ExecutionContext, callHandler).subscribe({
      error: (res) => {
        expect(errorSpy).toHaveBeenCalledWith(error);
        expect(mockResponse.status).toHaveBeenCalledWith(400);
        expect(mockResponse.json).toHaveBeenCalledWith({ message :'BAD_REQUEST', error});
        done();
      },
    });
  });

  it('should use 500 if no statusCode or code is present', (done) => {
    const error = {displayMessage: 'Internal Server Error'};
    jest.spyOn(ResponseHandler, 'error').mockReturnValue({ message :'Internal Server Error', error});

    const callHandler: CallHandler = {
      handle: () => throwError(() => error),
    } as any;

    interceptor.intercept(mockContext as ExecutionContext, callHandler).subscribe({
      error: (res) => {
        expect(mockResponse.status).toHaveBeenCalledWith(500);
        expect(mockResponse.json).toHaveBeenCalledWith({ message :'Internal Server Error', error});
        done();
      },
    });
  });
});