export class OverviewDTO{
    storageDetails:storageDetail
    jobDetails:jobDetail
}

export interface storageDetail{ 
    totalDiscoveredSize: string;
    totalMigratedSize: string;
    totalPendingSize: string;
    totalFileServers: number;
}

export interface jobDetail{ 

    totalDiscoverJobs: number;
    totalMigrateJobs: number;
    totalCutoverJobs:number;
}
