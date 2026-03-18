import { PreCheckErrorCodes, PreCheckStatus } from "src/workflows/pre-check/pre-check.types";

export interface PreCheckPathOutput{
    pathId: string;
    status: PreCheckStatus;
    errorCodes?: PreCheckErrorCodes[];
    warnings?: PreCheckErrorCodes[];
    workerId: string;
    destinationIsEmpty?: boolean;
    sourceDataSize?: number;
    destinationAvailableSpace?: number;
}