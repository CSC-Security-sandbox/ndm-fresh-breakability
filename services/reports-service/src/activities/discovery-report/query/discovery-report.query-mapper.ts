import { DiscoveryReportSection } from "../discovery-report.type";
import { ACCESS_TIME_DISTRIBUTION, CREATED_TIME_DISTRIBUTION, DEPTH_DISTRIBUTION, EXTENSION_DISTRIBUTION, FILE_SYSTEM_DISTRIBUTION, JOB_RUN_DETAILS, MAX_VALUES, MODIFIED_TIME_DISTRIBUTION, NUMBER_OF_FILES_BY_SIZE, TOP_BIGGEST_FILE_NAME, TOP_DIRECTORY_WITH_MAX_COUNT_CHILD, TOP_DIRECTORY_WITH_MAX_SIZE, TOP_LONGEST_DIRECTORY_NAMES, TOP_LONGEST_DIRECTORY_PATHS, TOP_LONGEST_FILE_NAMES, TOP_LONGEST_FILE_PATHS } from "./discovery-report.query";
import { AccessTimeDistributionInput, CreatedTimeDistributionInput, DepthDistributionInput, ExtensionDistributionInput, FileSystemDistributionInput, JobRunDetailsInput, MaxValuesInput, ModifiedTimeDistributionInput, NumberOfFilesBySizeInput, TopBiggestFileNameInput, TopDirectoryWithMaxCountChildInput, TopDirectoryWithMaxSizeInput, TopLongestDirectoryNamesInput, TopLongestDirectoryPathsInput, TopLongestFileNamesInput, TopLongestFilePathsInput } from "./discovery-report.query.type";
import { SECONDS_PER_MINUTE, SECONDS_PER_HOUR, SECONDS_PER_DAY, TIME_UNITS } from "../../../constants/report";


const buildTimeComponent = (value: number, timeUnit: { singular: string; plural: string }): string => {
    if (value === 0) return '';
    const unitText = value === 1 ? timeUnit.singular : timeUnit.plural;
    return `${value}${unitText}`;
};

const shouldIncludeSeconds = (totalSeconds: number, seconds: number): boolean => {
    if (totalSeconds < SECONDS_PER_MINUTE) return true;
    if (totalSeconds < SECONDS_PER_DAY) return seconds > 0;
    return false;
};

const formatTimeComponents = (components: { value: number; timeUnit: { singular: string; plural: string } }[]): string => {
    return components
        .filter(comp => comp.value > 0)
        .map(comp => buildTimeComponent(comp.value, comp.timeUnit))
        .join(' ');
};

const formatTime = (timeInSeconds: number): string => {
    const totalSeconds = Math.floor(timeInSeconds);
    if (totalSeconds < SECONDS_PER_MINUTE) {
        const unitText = (totalSeconds === 0 || totalSeconds === 1) ? TIME_UNITS.SECONDS.singular : TIME_UNITS.SECONDS.plural;
        return `${totalSeconds}${unitText}`;
    }
    const days = Math.floor(totalSeconds / SECONDS_PER_DAY);
    const hours = Math.floor((totalSeconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
    const mins = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    const secs = totalSeconds % SECONDS_PER_MINUTE;
    const components = [];
    
    if (days > 0) {
        components.push({ value: days, timeUnit: TIME_UNITS.DAYS });
    }
    if (hours > 0) {
        components.push({ value: hours, timeUnit: TIME_UNITS.HOURS });
    }
    if (mins > 0) {
        components.push({ value: mins, timeUnit: TIME_UNITS.MINUTES });
    }
    if (shouldIncludeSeconds(totalSeconds, secs)) {
        components.push({ value: secs, timeUnit: TIME_UNITS.SECONDS });
    }
    return formatTimeComponents(components);
};


export const NUMBER_OF_FILES_BY_SIZE_MAPPER = (input:NumberOfFilesBySizeInput[]) : DiscoveryReportSection[]=> {
    const output: DiscoveryReportSection[] = [];
    input.forEach(item => {
        output.push({
            value: parseInt(item.count, 0),
            category: 'Number of Files',
            valueType: 'count',
            sub_category: `File Count with ${item.size_group}`
        });
        output.push({
            value: parseInt(item.total_size, 0),
            category: 'Space Used',
            valueType: 'size',
            sub_category: `Capacity with ${item.size_group}`
        });
    });
    return output;
}

export const MODIFIED_TIME_DISTRIBUTION_MAPPER = (input: ModifiedTimeDistributionInput[]) : DiscoveryReportSection[] => {
    const output: DiscoveryReportSection[] = [];
    input.forEach(item => {
        output.push({
            value: parseInt(item.count, 0),
            category: 'Modified',
            valueType: 'count',
            sub_category: `File Count with Modification Time ${item.modified_group}`
        });
        output.push({
            value: parseInt(item.total_size, 0),
            category: 'Modified',
            valueType: 'size',
            sub_category: `Capacity With Modification Time ${item.modified_group}`
        });
    });
    return output;
}

export const CREATED_TIME_DISTRIBUTION_MAPPER = (input: CreatedTimeDistributionInput[]) : DiscoveryReportSection[] => {
    const output: DiscoveryReportSection[] = [];
    input.forEach(item => {
        output.push({
            value: parseInt(item.count, 0),
            category: 'Created',
            valueType: 'count',
            sub_category: `File Count with Creation Time ${item.created_group}`
        });
        output.push({
            value: parseInt(item.total_size, 0),
            category: 'Created',
            valueType: 'size',
            sub_category: `Capacity with Creation Time ${item.created_group}`
        });
    });
    return output;
}

export const ACCESS_TIME_DISTRIBUTION_MAPPER = (input: AccessTimeDistributionInput[]) : DiscoveryReportSection[] => {
    const output: DiscoveryReportSection[] = [];
    input.forEach(item => {
        output.push({
            value: parseInt(item.count, 0),
            category: 'Access Time',
            valueType: 'count',
            sub_category: `File Count with Access Time ${item.access_group}`
        });
        output.push({
            value: parseInt(item.total_size, 0),
            category: 'Access Time',
            valueType: 'size',
            sub_category: `Capacity with Access Time ${item.access_group}`
        });
    });
    return output;
}

export const DEPTH_DISTRIBUTION_MAPPER = (input: DepthDistributionInput[]) : DiscoveryReportSection[] => {
    const output: DiscoveryReportSection[] = [];
    input.forEach(item => {
        output.push({
            value: parseInt(item.count, 0),
            category: 'Depth',
            valueType: 'count',
            sub_category: `Files and Directory with depth: ${item.depth_group}`
        });
        output.push({
            value: parseInt(item.total_size, 0),
            category: 'Depth',
            valueType: 'size',
            sub_category: `Capacity with depth: ${item.depth_group}`
        });
    });
    return output;
}

export const FILE_SYSTEM_DISTRIBUTION_MAPPER = (input: FileSystemDistributionInput) : DiscoveryReportSection[] => {
    const output: DiscoveryReportSection[] = [];
    const mappings = [
        { value: input[0].total_count, valueType: 'count', sub_category: 'Total Count' },
        { value: input[0].regular_files, valueType: 'count', sub_category: 'Regular Files' },
        { value: input[0].symbolic_links, valueType: 'count', sub_category: 'Symbolic Links' },
        { value: input[0].total_space_regular_files, valueType: 'size', sub_category: 'Total Space for Regular Files' },
        { value: input[0].total_space_directories, valueType: 'size', sub_category: 'Total Space for Directories' },
        { value: input[0].total_space_used, valueType: 'size', sub_category: 'Total Space Used' },
    ];
    mappings.forEach(({ value, valueType, sub_category }) => {
        output.push({
            value,
            category: 'File System Stats',
            valueType,
            sub_category
        });
    });
    return output
}

export const EXTENSION_DISTRIBUTION_MAPPER = (input: ExtensionDistributionInput[]) : DiscoveryReportSection[] => {
    const output: DiscoveryReportSection[] = [];
    input.forEach(item => {
        if (item.extension === 'TOTAL_OF_TOP_5') {
            // Special handling for the total row
            output.push({
                value: `Total of Top 5 Extensions - size(${item.total_size});count(${item.count})`,
                category: 'Top File Extensions Summary',
                valueType: 'string',
                sub_category: 'Top 5 Extensions Total'
            });
        } else {
            // Regular extension rows
            output.push({
                value: `size(${item.total_size});count(${item.count})`,
                category: 'Top 5 File Extensions (with file Capacity and Count)',
                valueType: 'string',
                sub_category: item.extension
            });
        }
    });
    return output;
}

export const MAX_VALUES_MAPPER = (input: MaxValuesInput[]) : DiscoveryReportSection[] => {
    const output: DiscoveryReportSection[] = [];
    input.forEach(item => {
        // Maximum Values
        output.push({
            value: parseInt(item.max_file_size, 0),
            category: 'Maximum Values',
            valueType: 'size',
            sub_category: 'max_file_size'
        });
        output.push({
            value: parseInt(item.max_depth, 0),
            category: 'Maximum Values',
            valueType: 'count',
            sub_category: 'max_depth'
        });
        output.push({
            value: parseInt(item.max_name_length, 0),
            category: 'Maximum Values',
            valueType: 'length',
            sub_category: 'max_name_length'
        });
        
        // Average Values
        output.push({
            value: Math.round(parseFloat(item.avg_file_size || '0') * 100) / 100,
            category: 'Average Values',
            valueType: 'size',
            sub_category: 'avg_file_size'
        });
        output.push({
            value: Math.round(parseFloat(item.avg_depth || '0') * 100) / 100,
            category: 'Average Values',
            valueType: 'count',
            sub_category: 'avg_depth'
        });
        output.push({
            value: Math.round(parseFloat(item.avg_name_length || '0') * 100) / 100,
            category: 'Average Values',
            valueType: 'length',
            sub_category: 'avg_name_length'
        });
        
        // Total Counts
        output.push({
            value: parseInt(item.total_directories, 0),
            category: 'Total Counts',
            valueType: 'count',
            sub_category: 'total_directories'
        });
        output.push({
            value: parseInt(item.total_files, 0),
            category: 'Total Counts',
            valueType: 'count',
            sub_category: 'total_files'
        });
    });
    return output;
}

export const TOP_LONGEST_FILE_NAMES_MAPPER = (input: TopLongestFileNamesInput[]) : DiscoveryReportSection[] => {
    const output: DiscoveryReportSection[] = [];
    output.push({
        value: input.map(item=> `${item.path} (${item.length})`).join('; '),
        category: 'Biggest',
        valueType: 'string',
        sub_category:'Top 5 Longest File Names'
    });
    return output
}

export const TOP_LONGEST_DIRECTORY_NAMES_MAPPER = (input: TopLongestDirectoryNamesInput[]) : DiscoveryReportSection[] => {
    const output: DiscoveryReportSection[] = [];
    output.push({
        value: input.map(item=> `${item.path} (${item.length})`).join('; '),
        category: 'Biggest',
        valueType: 'string',
        sub_category:'Top 5 Longest Directory Names'
    });
    return output
}

export const TOP_DIRECTORY_WITH_MAX_SIZE_MAPPER = (input: TopDirectoryWithMaxSizeInput[]) : DiscoveryReportSection[] => {
    const output: DiscoveryReportSection[] = [];
    output.push({
        value: input.map(item=> `${item.directory} (${item.total_size})`).join('; '),
        category: 'Biggest',
        valueType: 'string',
        sub_category: 'Top 5 Biggest Directory With Capacity'
    });
    return output;
}

export const TOP_DIRECTORY_WITH_MAX_COUNT_CHILD_MAPPER = (input: TopDirectoryWithMaxCountChildInput[]) : DiscoveryReportSection[] => {
    const output: DiscoveryReportSection[] = [];
    output.push({
        value: input.map(item=> `${item.directory} (${item.child})`).join('; '),
        category: 'Biggest',
        valueType: 'string',
        sub_category: 'Top 5 Biggest Directory With Count'
    });
    return output;
}

export const TOP_LONGEST_DIRECTORY_PATHS_MAPPER = (input: TopLongestDirectoryPathsInput[]) : DiscoveryReportSection[] => {
    const output: DiscoveryReportSection[] = [];
    output.push({
        value: input.map(item=> `${item.path} (${item.length})`).join('; '),
        category: 'Biggest',
        valueType: 'string',
        sub_category: 'Top 5 Longest Directory Path'
    });
    return output;
}

export const TOP_LONGEST_FILE_PATHS_MAPPER = (input: TopLongestFilePathsInput[]) : DiscoveryReportSection[] => {
    const output: DiscoveryReportSection[] = [];
    output.push({
        value: input.map(item=> `${item.path} (${item.length})`).join('; '),
        category: 'Biggest',
        valueType: 'string',
        sub_category: 'Top 5 Longest File Path'
    });
    return output;
}
export const TOP_BIGGEST_FILE_NAME_MAPPER = (input: TopBiggestFileNameInput[]) : DiscoveryReportSection[] => {
    const output: DiscoveryReportSection[] = [];
    output.push({
        value: input.map(item=> `${item.path} (${item.file_size})`).join('; '),
        category: 'Biggest',
        valueType: 'string',
        sub_category: 'Top 5 Biggest File Names'
    });
    return output;
}

export const JOB_RUN_DETAILS_MAPPER = (input: JobRunDetailsInput[]) : DiscoveryReportSection[] => {
    const output: DiscoveryReportSection[] = [];
    if (input.length > 0) {
        const item = input[0];
        const fileServerInfo = [
            { value: item.volume_path, sub_category: 'Path' },
            { value: item.config_name, sub_category: 'Config Name' },
            { value: item.protocol, sub_category: 'Protocol' }
        ];
        fileServerInfo.forEach(({ value, sub_category }) => {
            output.push({
                value,
                category: 'File Server Info',
                valueType: 'string',
                sub_category
            });
        });
        output.push({
            value: item.status,
            category: 'Job Run Stats',
            valueType: 'status',
            sub_category: 'Status'
        });
        output.push({
            value: formatTime(parseFloat(item.stat_value) || 0),
            category: 'Job Run Stats',
            valueType: 'string',
            sub_category: 'Total Time'
        });
    }
    return output;
}

export const QueryMapper = {
    ['NUMBER_OF_FILES_BY_SIZE']: {query: NUMBER_OF_FILES_BY_SIZE , mapper: NUMBER_OF_FILES_BY_SIZE_MAPPER , isDynamic: false},
    ['MODIFIED_TIME_DISTRIBUTION']: {query: MODIFIED_TIME_DISTRIBUTION, mapper: MODIFIED_TIME_DISTRIBUTION_MAPPER, isDynamic: false},
    ['CREATED_TIME_DISTRIBUTION']: {query: CREATED_TIME_DISTRIBUTION, mapper: CREATED_TIME_DISTRIBUTION_MAPPER, isDynamic: false},
    ['ACCESS_TIME_DISTRIBUTION']: {query: ACCESS_TIME_DISTRIBUTION, mapper: ACCESS_TIME_DISTRIBUTION_MAPPER, isDynamic: false},
    ['DEPTH_DISTRIBUTION']: {query: DEPTH_DISTRIBUTION, mapper: DEPTH_DISTRIBUTION_MAPPER, isDynamic: false},
    ['FILE_SYSTEM_DISTRIBUTION']: {query: FILE_SYSTEM_DISTRIBUTION, mapper: FILE_SYSTEM_DISTRIBUTION_MAPPER, isDynamic: false},
    ['MAX_VALUES']: {query: MAX_VALUES, mapper: MAX_VALUES_MAPPER, isDynamic: false},
    ['EXTENSION_DISTRIBUTION']: {query: EXTENSION_DISTRIBUTION, mapper: EXTENSION_DISTRIBUTION_MAPPER, isDynamic: true},
    ['TOP_LONGEST_FILE_NAMES']: {query: TOP_LONGEST_FILE_NAMES, mapper: TOP_LONGEST_FILE_NAMES_MAPPER, isDynamic: true},
    ['TOP_LONGEST_DIRECTORY_NAMES']: {query: TOP_LONGEST_DIRECTORY_NAMES, mapper: TOP_LONGEST_DIRECTORY_NAMES_MAPPER, isDynamic: true},
    ['TOP_DIRECTORY_WITH_MAX_SIZE']: {query: TOP_DIRECTORY_WITH_MAX_SIZE, mapper: TOP_DIRECTORY_WITH_MAX_SIZE_MAPPER, isDynamic: true},
    ['TOP_DIRECTORY_WITH_MAX_COUNT_CHILD']: {query: TOP_DIRECTORY_WITH_MAX_COUNT_CHILD, mapper: TOP_DIRECTORY_WITH_MAX_COUNT_CHILD_MAPPER, isDynamic: true},
    ['TOP_LONGEST_DIRECTORY_PATHS']: {query: TOP_LONGEST_DIRECTORY_PATHS, mapper: TOP_LONGEST_DIRECTORY_PATHS_MAPPER, isDynamic: true},
    ['TOP_LONGEST_FILE_PATHS']: {query: TOP_LONGEST_FILE_PATHS, mapper: TOP_LONGEST_FILE_PATHS_MAPPER, isDynamic: true},
    ['TOP_BIGGEST_FILE_NAME']: {query: TOP_BIGGEST_FILE_NAME, mapper: TOP_BIGGEST_FILE_NAME_MAPPER, isDynamic: true},
    ['JOB_RUN_DETAILS']: {query : JOB_RUN_DETAILS, mapper: JOB_RUN_DETAILS_MAPPER, isDynamic: false}
}

export const DynamicMaps: string[] = Object.entries(QueryMapper)
    .filter(([, v]) => v.isDynamic)
    .map(([k]) => k);

export const QueryList: string[] = Object.entries(QueryMapper)
    .filter(([, v]) => !v.isDynamic)
    .map(([k]) => k);