import { Protocol } from "src/constants/enums";



export interface PathsAck {
    config: {
        configId: string;
        protocol: Protocol,
    }
    path: [{
        mountPath: string;
        account: string;
    }]
}