import {MessageCatalog} from '../constants/success';
// This file is part of the API Response Handler library.
// This library provides a utility function to set messages based on request and data.
export const setMessage = <T, msg extends string>(req, data: T): msg => {
    let responseMessage = 'Request Processed Successfully';
    if (req.route.path) {
        const functionality = req.route.path.split('/').pop()!;
     if (typeof data === 'object' && (data as any).message) {
            responseMessage = (data as any).message;
        } else {
            console.log(
                'Data inside the set MessageCatalog[parentFunctionality]?.message ',
                req.method,
            );
            responseMessage =
                MessageCatalog[functionality]?.message ||
                responseMessage;
        }
    }
    return responseMessage as msg;
};

export const formatDataResponse:any =(data: any): void => {
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