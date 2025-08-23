export interface DiscoveryReportSection {
    value: any;
    category: string;
    valueType: string;
    sub_category: string;
}

export interface GetDiscoverySectionInput {
    jobRunId: string;
    section: string;
    updateSection: Boolean;
}
export interface GenerateDiscoveryReportInput {
    jobRunId: string;
}

export interface UpdateDiscoveryReportInput {
    jobRunId: string;
    data?: DiscoveryReportSection[];
    updateType: 'data' | 'status'
}