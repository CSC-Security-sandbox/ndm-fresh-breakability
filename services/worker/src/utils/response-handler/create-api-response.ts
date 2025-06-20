import { ApiResponse } from './response.interface';
import { ResponseHandler } from './response-handler';

export enum RESPONSESTATUS {
  SUCCESS = 'success',
  ERROR = 'error',
}
export class CreatApiResponse {
  static apiResponse(status: string, data: any): ApiResponse<any> {
    const message = data.message;
    delete data.message;
    if (status === RESPONSESTATUS.SUCCESS) {
      return ResponseHandler.success(
        data,
        message || 'Request successful',
        status,
      );
    } else if (status === RESPONSESTATUS.ERROR) {
      console.log(`Error in response: ${data}`);
      return ResponseHandler.error(
        data,
        message || 'An error occurred',
        status,
      );
    }
  }
}
