import { Protocol } from "src/constants/enums";
import { Operations } from "src/constants/status";

export const OperationToProtocol = (operation : Operations):Protocol => {
    switch(operation) {
        case Operations.LIST_NFS_PATHS || Operations.VALIDATE_NFS_CONNECTION:
            return Protocol.NFS
        case Operations.LIST_SMB_PATHS || Operations.VALIDATE_SMB_CONNECTION:
            return Protocol.SMB
        default:
            throw new Error('Invalid Operation')
    }
}