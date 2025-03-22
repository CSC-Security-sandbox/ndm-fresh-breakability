import { PreCheckErrorCodes, PreCheckStatus } from "src/workflows/pre-check/pre-check.types";

export interface PreCheckPathOutput{
    pathId: string;
    status: PreCheckStatus;
    errorCode?: PreCheckErrorCodes;
    workerId: string;
}