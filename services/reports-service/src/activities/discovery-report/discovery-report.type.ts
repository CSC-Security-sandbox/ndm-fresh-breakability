export interface DiscoveryReportSection {
    value: any;
    category: string;
    valueType: string;
    sub_category: string;
}

export interface GetDiscoverySectionInput {
    jobRunId: string;
    section: string
}
export interface GenerateDiscoveryReportInput {
    jobRunId: string;
    data: DiscoveryReportSection[];
}

export interface UpdateDiscoveryReportInput {
    jobRunId: string;
    data: DiscoveryReportSection[];
}