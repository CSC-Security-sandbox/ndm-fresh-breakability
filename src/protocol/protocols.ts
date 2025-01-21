import { NFSProtocol } from "./protocols/nfs.protocol";
import { Protocol } from "./protocols/protocol";
import { SMBProtocol } from "./protocols/smb.protocol";


export enum ProtocolTypes {
    SMB = 'SMB',
    NFS = 'NFS'
}

export class Protocols {
    static getProtocol(protocolType: ProtocolTypes): Protocol {
        switch (protocolType) {
            case ProtocolTypes.SMB:
                return new SMBProtocol();
            case ProtocolTypes.NFS:
                return new NFSProtocol();
            default:
                throw new Error(`Unsupported protocol type: ${protocolType}`);
        }
    }
}