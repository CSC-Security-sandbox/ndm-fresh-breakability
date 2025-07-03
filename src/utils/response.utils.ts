import {MessageCatalog, MessageKey} from '../constants/success';

import {ErrorCatalog, ErrorKey} from '../constants/error';
import {Request} from 'express';
import { stringify } from 'flatted';
import {CustomSuccessDTO} from '../dto/custom-success-dto';
import {CustomErrorDTO} from '../dto/custom-error-dto';
// This file is part of the API Response Handler library.
// This library provides a utility function to set messages based on request and data.
export const setSuccessMessage = <T, msg extends string>
(req :Request, data: T, customSuccessDTOList:CustomSuccessDTO[]): msg => {
    let responseMessage =  MessageCatalog[MessageKey.Default]['message'];
    console.log('reponse###########',customSuccessDTOList);

    if (req.path) {
        const apiEndPoint = req.path.split('/').pop()!;
        console.log('apiEndPoint', apiEndPoint);
        if (typeof data === 'object' && (data as any).message) {
            responseMessage = (data as any).message;
        } else {
            const matchingSuccessDTO = customSuccessDTOList.find(dto => (dto.apiEndPointKey === apiEndPoint && dto.method === req.method));
                console.log('matchingSuccessDTO>>>>>>>>>>>>>>', matchingSuccessDTO);
            responseMessage = matchingSuccessDTO?.message ||
                MessageCatalog[apiEndPoint]?.message ||
            responseMessage;
        }
    }
    console.log('responseMessage', responseMessage);
    return responseMessage as msg;
};
export const setErrorMessage = <T, msg extends string>
(request: Request, errorResponse: any, customErrorDTOList: CustomErrorDTO[]): msg => {
    let errorMessage = ErrorCatalog[ErrorKey.DefaultError]?.message;
    const apiEndPoint = request.path.split('/').pop()!;
    console.log('apiEndPoint', apiEndPoint);
    const matchingErrorDTOByEndpoint = customErrorDTOList.find(dto => dto.apiEndPointKey === apiEndPoint);
    console.log('matchingErrorDTOByEndpoint', matchingErrorDTOByEndpoint);
    const matchingErrorDTOByCode = errorResponse?.status || errorResponse?.statusCode || errorResponse?.code //customErrorDTOList.find(dto =>
    console.log('matchingErrorDTOByEndpoint', matchingErrorDTOByEndpoint);
    errorMessage = matchingErrorDTOByEndpoint?.message || errorResponse?.response?.message ||
                   ErrorCatalog[matchingErrorDTOByCode.toString()]?.message ||
                   errorMessage;

    return errorMessage as msg;
};


export const formatResponseData:any =(data: any): any => {
    let responseData: any = {};
    if (Array.isArray(data)) {
        responseData.items = [...data];
    } else if (typeof data === 'object' && data !== null) {
        const { id, message: _msg, ...rest } = data as any;
        if (id !== undefined) responseData.id = id;
        responseData.items = { ...rest };
    } else {
        responseData.items = data;
    }
    return responseData;
}
