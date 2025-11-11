/* query-mapper.ts */
export interface NumberOfFilesBySizeInput {
    size_group: string;
    count: string;
    total_size: string;
}
export interface ModifiedTimeDistributionInput {
    modified_group: string;
    count: string;
    total_size: string;
}
export interface CreatedTimeDistributionInput {
    created_group: string;
    count: string;
    total_size: string;
}
export interface AccessTimeDistributionInput {
    access_group: string;
    count: string;
    total_size: string;
}
export interface DepthDistributionInput {
    depth_group: string;
    count: string;
    total_size: string;
}
export interface FileSystemDistributionInput {
    total_count: string
    regular_files: string;
    symbolic_links: string;
    total_space_regular_files: string;
    total_space_directories: string;
    total_space_used: string;
    total_hard_link_files: string;
    total_junctions: string;
    total_volume_mount_point: string;
    total_shortcuts: string;
}
export interface ExtensionDistributionInput {
    extension: string;
    count: string;
    total_size: string;
}
export interface MaxValuesInput {
    max_file_size: string;
    max_depth: string;
    max_name_length: string;
    avg_file_size: string;
    avg_depth: string;
    avg_name_length: string;
    total_directories: string;
    total_files: string;
}
export interface TopLongestFileNamesInput {
    path: string;
    length: string;
}
export interface TopLongestDirectoryNamesInput {
    path: string;
    length: string;
}
export interface TopDirectoryWithMaxSizeInput {
    directory: string;
    total_size: string;
}
export interface TopDirectoryWithMaxCountChildInput {
    directory: string;
    child: string;
}
export interface TopLongestDirectoryPathsInput {
    path: string;
    length: string;
}
export interface TopLongestFilePathsInput {
    path: string;
    length: string;
}
export interface TopBiggestFileNameInput {
    path: string;
    file_size: string;
}
export interface RedirectsFileNameInput {
    file_type: string;
    path: string;
}


export interface JobRunDetailsInput {
    stat_value: string;
    volume_path: string;
    status: string;
    config_name: string;
    protocol: string;
}

export interface EEXISTErrorsInput {
    parent_path: string;
    file_paths: Array<string>;
}
