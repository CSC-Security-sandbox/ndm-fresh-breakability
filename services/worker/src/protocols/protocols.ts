import { NFSProtocol } from "./nfs/nfs.protocol";
import { Protocol } from "./protocol/protocol";
import { SMBProtocol } from "./smb/smb.protocol";
import { Injectable } from '@nestjs/common';

export enum ProtocolTypes {
    SMB = 'SMB',
    NFS = 'NFS'
}

@Injectable()
export class Protocols {
    constructor (
        private readonly nfsProtocol: NFSProtocol,
        private readonly smbProtocol: SMBProtocol
    ) {}

    getProtocol(protocolType: ProtocolTypes): Protocol {
        switch (protocolType) {
            case ProtocolTypes.SMB:
                return this.smbProtocol;
            case ProtocolTypes.NFS:
                return this.nfsProtocol;
            default:
                throw new Error(`Unsupported protocol type: ${protocolType}`);
        }
    }
}
