import {

NUMBER_OF_FILES_BY_SIZE_MAPPER,
MODIFIED_TIME_DISTRIBUTION_MAPPER,
CREATED_TIME_DISTRIBUTION_MAPPER,
ACCESS_TIME_DISTRIBUTION_MAPPER,
DEPTH_DISTRIBUTION_MAPPER,
FILE_SYSTEM_DISTRIBUTION_MAPPER,
EXTENSION_DISTRIBUTION_MAPPER,
MAX_VALUES_MAPPER,
TOP_LONGEST_FILE_NAMES_MAPPER,
TOP_LONGEST_DIRECTORY_NAMES_MAPPER,
TOP_DIRECTORY_WITH_MAX_SIZE_MAPPER,
TOP_DIRECOTRY_WITH_MAX_COUNT_CHILD_MAPPER,
TOP_LONGEST_DIRECTORY_PATHS_MAPPER,
TOP_LONGEST_FILE_PATHS_MAPPER,
TOP_BIGGEST_FILE_NAME_MAPPER,
JOB_RUN_DETAILS_MAPPER,
QueryMapper,
QueryList
} from './discovery-report.query-mapper';

describe('discovery-report.query-mapper', () => {
it('NUMBER_OF_FILES_BY_SIZE_MAPPER maps input correctly', () => {
    const input = [{ count: '5', total_size: '100', size_group: '1MB-10MB' }];
    const result = NUMBER_OF_FILES_BY_SIZE_MAPPER(input as any);
    expect(result).toEqual([
        {
            value: 5,
            category: 'Number of Files',
            valueType: 'count',
            sub_category: 'File Count with 1MB-10MB'
        },
        {
            value: 100,
            category: 'Space Used',
            valueType: 'size',
            sub_category: 'Capacity with 1MB-10MB'
        }
    ]);
});

it('MODIFIED_TIME_DISTRIBUTION_MAPPER maps input correctly', () => {
    const input = [{ count: '2', total_size: '50', modified_group: 'Last Month' }];
    const result = MODIFIED_TIME_DISTRIBUTION_MAPPER(input as any);
    expect(result).toEqual([
        {
            value: 2,
            category: 'Modified',
            valueType: 'count',
            sub_category: 'File Count with Modification Time Last Month'
        },
        {
            value: 50,
            category: 'Modified',
            valueType: 'size',
            sub_category: 'Capacity With Modification Time Last Month'
        }
    ]);
});

it('CREATED_TIME_DISTRIBUTION_MAPPER maps input correctly', () => {
    const input = [{ count: '3', total_size: '75', created_group: '2023' }];
    const result = CREATED_TIME_DISTRIBUTION_MAPPER(input as any);
    expect(result).toEqual([
        {
            value: 3,
            category: 'Created',
            valueType: 'count',
            sub_category: 'File Count with Creation Time2023'
        },
        {
            value: 75,
            category: 'Created',
            valueType: 'size',
            sub_category: 'Capacity with Creation Time 2023'
        }
    ]);
});

it('ACCESS_TIME_DISTRIBUTION_MAPPER maps input correctly', () => {
    const input = [{ count: '4', total_size: '200', access_group: 'Today' }];
    const result = ACCESS_TIME_DISTRIBUTION_MAPPER(input as any);
    expect(result).toEqual([
        {
            value: 4,
            category: 'Access Time',
            valueType: 'count',
            sub_category: 'File Count with Access Time Today'
        },
        {
            value: 200,
            category: 'Access Time',
            valueType: 'size',
            sub_category: 'Capacity with Access Time Today'
        }
    ]);
});

it('DEPTH_DISTRIBUTION_MAPPER maps input correctly', () => {
    const input = [{ count: '7', total_size: '300', depth_group: '2' }];
    const result = DEPTH_DISTRIBUTION_MAPPER(input as any);
    expect(result).toEqual([
        {
            value: 7,
            category: 'Depth',
            valueType: 'count',
            sub_category: 'Files and Directory with depth: 2'
        },
        {
            value: 300,
            category: 'Depth',
            valueType: 'size',
            sub_category: 'Capacity with depth: 2'
        }
    ]);
});

it('FILE_SYSTEM_DISTRIBUTION_MAPPER maps input correctly', () => {
    const input = [{
        total_count: 10,
        regular_files: 8,
        symbolic_links: 2,
        total_space_regular_files: 500,
        total_space_directories: 100,
        total_space_used: 600
    }];
    const result = FILE_SYSTEM_DISTRIBUTION_MAPPER(input as any);
    expect(result).toEqual([
        { value: 10, category: 'File System Stats', valueType: 'count', sub_category: 'Total Count' },
        { value: 8, category: 'File System Stats', valueType: 'count', sub_category: 'Regular Files' },
        { value: 2, category: 'File System Stats', valueType: 'count', sub_category: 'Symbolic Links' },
        { value: 500, category: 'File System Stats', valueType: 'size', sub_category: 'Total Space for Regular Files' },
        { value: 100, category: 'File System Stats', valueType: 'size', sub_category: 'Total Space for Directories' },
        { value: 600, category: 'File System Stats', valueType: 'size', sub_category: 'Total Space Used' }
    ]);
});

it('EXTENSION_DISTRIBUTION_MAPPER maps input correctly', () => {
    const input = [{ extension: '.txt', total_size: '123', count: '10' }];
    const result = EXTENSION_DISTRIBUTION_MAPPER(input as any);
    expect(result).toEqual([
        {
            value: 'size(123);count(10)',
            category: 'Top File Extensions (with file Capacity and Count)',
            valueType: 'string',
            sub_category: '.txt'
        }
    ]);
});

it('MAX_VALUES_MAPPER maps input correctly', () => {
    const input = [{ max_file_size: '1000', max_name_length: '255', total_directories: '5' }];
    const result = MAX_VALUES_MAPPER(input as any);
    expect(result).toEqual([
        { value: 1000, category: 'Maximum Values', valueType: 'size', sub_category: 'max_file_size' },
        { value: 255, category: 'Maximum Values', valueType: 'length', sub_category: 'max_name_length' },
        { value: 5, category: 'Maximum Values', valueType: 'count', sub_category: 'total_directories' }
    ]);
});

it('TOP_LONGEST_FILE_NAMES_MAPPER maps input correctly', () => {
    const input = [{ path: '/a/b.txt', length: 6 }, { path: '/c/d.txt', length: 6 }];
    const result = TOP_LONGEST_FILE_NAMES_MAPPER(input as any);
    expect(result).toEqual([
        {
            value: '/a/b.txt (6); /c/d.txt (6)',
            category: 'Biggest',
            valueType: 'string',
            sub_category: 'Top 5 Longest File Names'
        }
    ]);
});

it('TOP_LONGEST_DIRECTORY_NAMES_MAPPER maps input correctly', () => {
    const input = [{ path: '/dir1', length: 5 }, { path: '/dir2', length: 5 }];
    const result = TOP_LONGEST_DIRECTORY_NAMES_MAPPER(input as any);
    expect(result).toEqual([
        {
            value: '/dir1 (5); /dir2 (5)',
            category: 'Biggest',
            valueType: 'string',
            sub_category: 'Top 5 Longest Directory Names'
        }
    ]);
});

it('TOP_DIRECTORY_WITH_MAX_SIZE_MAPPER maps input correctly', () => {
    const input = [{ directory: '/dir1', total_size: 100 }, { directory: '/dir2', total_size: 200 }];
    const result = TOP_DIRECTORY_WITH_MAX_SIZE_MAPPER(input as any);
    expect(result).toEqual([
        {
            value: '/dir1 (100); /dir2 (200)',
            category: 'Biggest',
            valueType: 'string',
            sub_category: 'Top 5 Biggest Directory With Capacity'
        }
    ]);
});

it('TOP_DIRECOTRY_WITH_MAX_COUNT_CHILD_MAPPER maps input correctly', () => {
    const input = [{ directory: '/dir1', child: 10 }, { directory: '/dir2', child: 20 }];
    const result = TOP_DIRECOTRY_WITH_MAX_COUNT_CHILD_MAPPER(input as any);
    expect(result).toEqual([
        {
            value: '/dir1 (10); /dir2 (20)',
            category: 'Biggest',
            valueType: 'string',
            sub_category: 'Top 5 Biggest Directory With Count'
        }
    ]);
});

it('TOP_LONGEST_DIRECTORY_PATHS_MAPPER maps input correctly', () => {
    const input = [{ path: '/a/b/c', length: 6 }, { path: '/d/e/f', length: 6 }];
    const result = TOP_LONGEST_DIRECTORY_PATHS_MAPPER(input as any);
    expect(result).toEqual([
        {
            value: '/a/b/c (6); /d/e/f (6)',
            category: 'Biggest',
            valueType: 'string',
            sub_category: 'Top 5 Longest Directory Path'
        }
    ]);
});

it('TOP_LONGEST_FILE_PATHS_MAPPER maps input correctly', () => {
    const input = [{ path: '/a/b.txt', length: 8 }, { path: '/c/d.txt', length: 8 }];
    const result = TOP_LONGEST_FILE_PATHS_MAPPER(input as any);
    expect(result).toEqual([
        {
            value: '/a/b.txt (8); /c/d.txt (8)',
            category: 'Biggest',
            valueType: 'string',
            sub_category: 'Top 5 Longest File Path'
        }
    ]);
});

it('TOP_BIGGEST_FILE_NAME_MAPPER maps input correctly', () => {
    const input = [{ path: '/a/b.txt', file_size: 100 }, { path: '/c/d.txt', file_size: 200 }];
    const result = TOP_BIGGEST_FILE_NAME_MAPPER(input as any);
    expect(result).toEqual([
        {
            value: '/a/b.txt (100); /c/d.txt (200)',
            category: 'Biggest',
            valueType: 'string',
            sub_category: 'Top 5 Biggest File Names'
        }
    ]);
});

it('JOB_RUN_DETAILS_MAPPER maps input correctly', () => {
    const input = [{
        volume_path: '/mnt/data',
        config_name: 'config1',
        protocol: 'NFS',
        status: 'SUCCESS',
        stat_value: 123
    }];
    const result = JOB_RUN_DETAILS_MAPPER(input as any);
    expect(result).toEqual([
        { value: '/mnt/data', category: 'File Server Info', valueType: 'string', sub_category: 'Path' },
        { value: 'config1', category: 'File Server Info', valueType: 'string', sub_category: 'Config Name' },
        { value: 'NFS', category: 'File Server Info', valueType: 'string', sub_category: 'Protocol' },
        { value: 'SUCCESS', category: 'Job Run Stats', valueType: 'status', sub_category: 'Status' },
        { value: 123, category: 'Job Run Stats', valueType: 'time', sub_category: 'Total Time' }
    ]);
});

it('JOB_RUN_DETAILS_MAPPER returns empty array for empty input', () => {
    expect(JOB_RUN_DETAILS_MAPPER([])).toEqual([]);
});

it('QueryMapper and QueryList are defined and consistent', () => {
    expect(QueryMapper).toBeDefined();
    expect(Array.isArray(QueryList)).toBe(true);
    QueryList.forEach(key => {
        expect(QueryMapper[key]).toBeDefined();
        expect(QueryMapper[key].mapper).toBeInstanceOf(Function);
    });
});
});