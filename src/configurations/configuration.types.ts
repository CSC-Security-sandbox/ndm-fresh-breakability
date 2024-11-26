import { Protocol } from "src/constants/enums";

export interface Credentials {
    protocol: Protocol;
    details: {
        username: string;
        hostname: string;
        password?: string
    }
    workers: string[]
}

export interface FetchMountMsg{
    configId: string;
    credentials: Credentials[]
}