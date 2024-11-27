import { Protocol } from "src/constants/enums";

export type Credentials= {
    protocol: Protocol;
    details: {
        username?: string;
        hostname?: string;
        password?: string
    }
    workers: string[]
}

export type ListPathsMsg = {
    configId: string;
    credentials: Credentials[]
}