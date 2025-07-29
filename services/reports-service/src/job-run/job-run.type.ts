export interface InventoryStatusSummary {
    isDirectory: boolean;
    counts: BigInt;
    totalFileSize: BigInt;
}

export  interface TaskStatusCount {
    status: string;
    count: string;
}

export type ReaderStatus = 'active' | 'inactive';
