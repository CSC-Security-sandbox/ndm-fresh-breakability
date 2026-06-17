import {MessageCatalog, MessageKey} from '../constants/success';

import {ErrorCatalog, ErrorKey} from '../constants/error';
import {Request} from 'express';
import {CustomSuccessDTO} from '../dto/custom-success-dto';
import {CustomErrorDTO} from '../dto/custom-error-dto';
import {LoggerService} from '@netapp-cloud-datamigrate/logger-lib';

// This library provides a utility function to set messages based on request and data.
export const setSuccessMessage = <T, msg extends string>
(req :Request, controllerResponseData: T, customSuccessDTOList: CustomSuccessDTO[]): msg => {

    let responseMessage =  MessageCatalog[MessageKey.Default]['message'];

    if (req.path) {
        const apiEndPoint = req.path.split('/').pop()!;
        if (typeof controllerResponseData === 'object' && (controllerResponseData as any).message) {
            responseMessage = (controllerResponseData as any).message;
        } else {
            const matchingSuccessDTO = customSuccessDTOList.find(dto => (dto.apiEndPointKey === apiEndPoint && dto.method === req.method));
            responseMessage = matchingSuccessDTO?.message ||
                MessageCatalog[apiEndPoint]?.message ||
            responseMessage;
        }
    }
    return responseMessage as msg;
};
export const setErrorMessage = <T, msg extends string>
(request: Request, errorResponse: any, customErrorDTOList: CustomErrorDTO[]): msg => {

    let errorMessage = ErrorCatalog[ErrorKey.DefaultError]?.message;
    
    const apiEndPoint = request.path.split('/').pop()!;
    const matchingErrorDTOByEndpoint = customErrorDTOList.find(dto => dto.apiEndPointKey === apiEndPoint);
    const matchingErrorDTOByCode = errorResponse?.status || errorResponse?.statusCode || errorResponse?.code //customErrorDTOList.find(dto =>

    let message=''
    if( typeof errorResponse?.response?.message === 'string') {
        message = errorResponse?.response?.message
    } else if(Array.isArray(errorResponse?.response)){
        message= ErrorCatalog[matchingErrorDTOByCode.toString()]?.message || errorResponse?.response?.map((item:any) =>item.message || item).join('\n');
    }
    errorMessage = message || matchingErrorDTOByEndpoint?.message ||
        ErrorCatalog[matchingErrorDTOByCode.toString()]?.message ||
        errorMessage;

    return errorMessage as msg;
};


export const formatResponseData:any =(data: any): any => {

    let responseData: any = {};

    if (Array.isArray(data)) {
        responseData.items = [...data];
    } else if (data !== null && typeof data === 'object' ) {
        if (Array.isArray(data.data) && 'total' in data) {
            responseData.items = [...data.data];
            responseData.meta = {
                total: data.total,
                page: data.page,
                pageSize: data.limit,
                hasMore: data.page * data.limit < data.total,
            };
        } else {
            const { id, message: _msg, ...rest } = data as any;
            if (id !== undefined) responseData.id = id;
            responseData.items = { ...rest };
        }
    } else {
        responseData.items = data;
    }
    
    return responseData;
}
