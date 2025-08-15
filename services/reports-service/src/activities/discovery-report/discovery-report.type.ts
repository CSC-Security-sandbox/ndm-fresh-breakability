
/* query-mapper.ts */
export interface NumberOfFilesBySizeInput {
    size_group: string;
    count: number;
    total_size: number;
}
export interface ModifiedTimeDistributionInput {
    modified_group: string;
    count: number;
    total_size: number;
}
export interface CreatedTimeDistributionInput {
    created_group: string;
    count: number;
    total_size: number;
}
export interface AccessTimeDistributionInput {
    access_group: string;
    count: number;
    total_size: number;
}
export interface DepthDistributionInput {
    depth_group: string;
    count: number;
    total_size: number;
}
export interface FileSystemDistributionInput {
    total_count: number
    regular_files: number;
    symbolic_links: number;
    total_space_regular_files: number;
    total_space_directories: number;
    total_space_used: number;
}
export interface ExtensionDistributionInput {
    extension: string;
    count: number;
    total_size: number;
}
export interface MaxValuesInput {
    max_file_size: string;
    max_name_length: string;
    total_directories: string;
}
export interface TopLongestFileNamesInput {
    path: string;
    length: number;
}
export interface TopLongestDirectoryNamesInput {
    path: string;
    length: number;
}
export interface TopDirectoryWithMaxSizeInput {
    directory: string;
    total_size: number;
}
export interface TopDirectoryWithMaxCountChildInput {
    directory: string;
    child: number;
}
export interface TopLongestDirectoryPathsInput {
    path: string;
    length: number;
}
export interface TopLongestFilePathsInput {
    path: string;
    length: number;
}
export interface TopBiggestFileNameInput {
    path: string;
    file_size: number;
}


export interface DiscoveryReportSection {
    value: any;
    category: string;
    valueType: string;
    sub_category: string;
}

export interface GenerateDiscoveryReportJsonInput {
    jobRunId: string;
    section: string
}