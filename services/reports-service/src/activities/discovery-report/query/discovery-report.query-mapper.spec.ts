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
TOP_DIRECTORY_WITH_MAX_COUNT_CHILD_MAPPER,
TOP_LONGEST_DIRECTORY_PATHS_MAPPER,
TOP_LONGEST_FILE_PATHS_MAPPER,
TOP_BIGGEST_FILE_NAME_MAPPER,
JOB_RUN_DETAILS_MAPPER,
QueryMapper,
QueryList,
REDIRECTS_FILE_NAME_MAPPER,
EEXIST_ERRORS_MAPPER
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
            sub_category: 'File Count with Creation Time 2023'
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
        total_hard_link_files: 3,
        total_junctions: 5,
        total_volume_mount_point: 4,
        total_shortcuts: 6,
        total_space_regular_files: 500,
        total_space_directories: 100,
        total_space_used: 600
    }];
    const result = FILE_SYSTEM_DISTRIBUTION_MAPPER(input as any);
    expect(result).toEqual([
        { value: 10, category: 'File System Stats', valueType: 'count', sub_category: 'Total Count' },
        { value: 8, category: 'File System Stats', valueType: 'count', sub_category: 'Regular Files Count' },
        { value: 2, category: 'File System Stats', valueType: 'count', sub_category: 'Symbolic Links Count' },
        { value: 3, category: 'File System Stats', valueType: 'count', sub_category: 'Hard Links Count' },
        { value: 5, category: 'File System Stats', valueType: 'count', sub_category: 'Junctions Count' },
        { value: 4, category: 'File System Stats', valueType: 'count', sub_category: 'Volume Mount Points Count' },
        { value: 6, category: 'File System Stats', valueType: 'count', sub_category: 'Shortcuts Count' },
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
            category: 'Top 5 File Extensions (with file Capacity and Count)',
            valueType: 'string',
            sub_category: '.txt'
        }
    ]);
});

it('EXTENSION_DISTRIBUTION_MAPPER handles multiple extensions correctly', () => {
    const input = [
        { extension: '.pdf', total_size: '500', count: '5' },
        { extension: '.jpg', total_size: '300', count: '15' },
        { extension: 'TOTAL_OF_TOP_5', total_size: '800', count: '20' }
    ];
    const result = EXTENSION_DISTRIBUTION_MAPPER(input as any);
    expect(result).toEqual([
        {
            value: 'size(500);count(5)',
            category: 'Top 5 File Extensions (with file Capacity and Count)',
            valueType: 'string',
            sub_category: '.pdf'
        },
        {
            value: 'size(300);count(15)',
            category: 'Top 5 File Extensions (with file Capacity and Count)',
            valueType: 'string',
            sub_category: '.jpg'
        },
        {
            value: 'Total of Top 5 Extensions - size(800);count(20)',
            category: 'Top File Extensions Summary',
            valueType: 'string',
            sub_category: 'Top 5 Extensions Total'
        }
    ]);
});

it('EXTENSION_DISTRIBUTION_MAPPER handles empty input array', () => {
    const input: any[] = [];
    const result = EXTENSION_DISTRIBUTION_MAPPER(input);
    expect(result).toEqual([]);
});

it('MAX_VALUES_MAPPER maps input correctly', () => {
    const input = [{
        max_file_size: '1000',
        max_depth: '10',
        max_name_length: '255',
        avg_file_size: '200.5',
        avg_depth: '5.2',
        avg_name_length: '150.7',
        total_directories: '5',
        total_files: '100'
    }];
    const result = MAX_VALUES_MAPPER(input as any);
    expect(result).toEqual([
        { value: 1000, category: 'Maximum Values', valueType: 'size', sub_category: 'max_file_size' },
        { value: 10, category: 'Maximum Values', valueType: 'count', sub_category: 'max_depth' },
        { value: 255, category: 'Maximum Values', valueType: 'length', sub_category: 'max_name_length' },
        { value: 200.5, category: 'Average Values', valueType: 'size', sub_category: 'avg_file_size' },
        { value: 5.2, category: 'Average Values', valueType: 'count', sub_category: 'avg_depth' },
        { value: 150.7, category: 'Average Values', valueType: 'length', sub_category: 'avg_name_length' },
        { value: 5, category: 'Total Counts', valueType: 'count', sub_category: 'total_directories' },
        { value: 100, category: 'Total Counts', valueType: 'count', sub_category: 'total_files' }
    ]);
});

    it('MAX_VALUES_MAPPER handles edge cases for average values', () => {
        const input = [{
            max_file_size: '500',
            max_depth: '5',
            max_name_length: '100',
            avg_file_size: '',           // Empty string - should default to 0
            avg_depth: undefined,        // Undefined - should use fallback '0'
            avg_name_length: '0.001',    // Very small number - should round to 0
            total_directories: '10',
            total_files: '50'
        }];
        const result = MAX_VALUES_MAPPER(input as any);
        expect(result).toEqual([
            { value: 500, category: 'Maximum Values', valueType: 'size', sub_category: 'max_file_size' },
            { value: 5, category: 'Maximum Values', valueType: 'count', sub_category: 'max_depth' },
            { value: 100, category: 'Maximum Values', valueType: 'length', sub_category: 'max_name_length' },
            { value: 0, category: 'Average Values', valueType: 'size', sub_category: 'avg_file_size' },     // Empty string → 0
            { value: 0, category: 'Average Values', valueType: 'count', sub_category: 'avg_depth' },       // undefined → 0
            { value: 0, category: 'Average Values', valueType: 'length', sub_category: 'avg_name_length' }, // 0.001 → 0
            { value: 10, category: 'Total Counts', valueType: 'count', sub_category: 'total_directories' },
            { value: 50, category: 'Total Counts', valueType: 'count', sub_category: 'total_files' }
        ]);
    });

    it('MAX_VALUES_MAPPER handles integer values correctly', () => {
        const input = [{
            max_file_size: '1000',
            max_depth: '10',
            max_name_length: '255',
            avg_file_size: '100',        // Integer - should remain 100
            avg_depth: '5.0',           // .0 decimal - should remain 5
            avg_name_length: '50.00',   // .00 decimal - should remain 50
            total_directories: '3',
            total_files: '75'
        }];
        const result = MAX_VALUES_MAPPER(input as any);
        expect(result).toEqual([
            { value: 1000, category: 'Maximum Values', valueType: 'size', sub_category: 'max_file_size' },
            { value: 10, category: 'Maximum Values', valueType: 'count', sub_category: 'max_depth' },
            { value: 255, category: 'Maximum Values', valueType: 'length', sub_category: 'max_name_length' },
            { value: 100, category: 'Average Values', valueType: 'size', sub_category: 'avg_file_size' },   // Integer preserved
            { value: 5, category: 'Average Values', valueType: 'count', sub_category: 'avg_depth' },        // .0 → 5
            { value: 50, category: 'Average Values', valueType: 'length', sub_category: 'avg_name_length' }, // .00 → 50
            { value: 3, category: 'Total Counts', valueType: 'count', sub_category: 'total_directories' },
            { value: 75, category: 'Total Counts', valueType: 'count', sub_category: 'total_files' }
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

it('TOP_DIRECTORY_WITH_MAX_COUNT_CHILD_MAPPER maps input correctly', () => {
    const input = [{ directory: '/dir1', child: 10 }, { directory: '/dir2', child: 20 }];
    const result = TOP_DIRECTORY_WITH_MAX_COUNT_CHILD_MAPPER(input as any);
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
        { value: '2mins 3sec', category: 'Job Run Stats', valueType: 'string', sub_category: 'Total Time' }
    ]);
});

it('JOB_RUN_DETAILS_MAPPER returns empty array for empty input', () => {
    expect(JOB_RUN_DETAILS_MAPPER([])).toEqual([]);
});

it('JOB_RUN_DETAILS_MAPPER formats time correctly for different ranges', () => {
    // Test seconds (< 1 minute)
    const inputSeconds = [{
        volume_path: '/test',
        config_name: 'test',
        protocol: 'NFS',
        status: 'SUCCESS',
        stat_value: 45
    }];
    const resultSeconds = JOB_RUN_DETAILS_MAPPER(inputSeconds as any);
    expect(resultSeconds[4]).toEqual({
        value: '45s',
        category: 'Job Run Stats',
        valueType: 'string',
        sub_category: 'Total Time'
    });

    // Test minutes (1 min to 1 hour)
    const inputMinutes = [{
        volume_path: '/test',
        config_name: 'test',
        protocol: 'NFS',
        status: 'SUCCESS',
        stat_value: 1950 // 32 mins 30 sec
    }];
    const resultMinutes = JOB_RUN_DETAILS_MAPPER(inputMinutes as any);
    expect(resultMinutes[4]).toEqual({
        value: '32mins 30sec',
        category: 'Job Run Stats',
        valueType: 'string',
        sub_category: 'Total Time'
    });

    // Test hours (1 hour to 24 hours)
    const inputHours = [{
        volume_path: '/test',
        config_name: 'test',
        protocol: 'NFS',
        status: 'SUCCESS',
        stat_value: 8430 // 2 hrs 20 mins 30 sec
    }];
    const resultHours = JOB_RUN_DETAILS_MAPPER(inputHours as any);
    expect(resultHours[4]).toEqual({
        value: '2hrs 20mins 30sec',
        category: 'Job Run Stats',
        valueType: 'string',
        sub_category: 'Total Time'
    });

    // Test days (> 24 hours)
    const inputDays = [{
        volume_path: '/test',
        config_name: 'test',
        protocol: 'NFS',
        status: 'SUCCESS',
        stat_value: 178200 // 2 days 1 hrs 30 mins
    }];
    const resultDays = JOB_RUN_DETAILS_MAPPER(inputDays as any);
    expect(resultDays[4]).toEqual({
        value: '2days 1hr 30mins',
        category: 'Job Run Stats',
        valueType: 'string',
        sub_category: 'Total Time'
    });
});

it('JOB_RUN_DETAILS_MAPPER handles invalid stat_value gracefully', () => {
    const input = [{
        volume_path: '/test',
        config_name: 'test',
        protocol: 'NFS',
        status: 'SUCCESS',
        stat_value: 'invalid'
    }];
    const result = JOB_RUN_DETAILS_MAPPER(input as any);
    expect(result[4]).toEqual({
        value: '0s',
        category: 'Job Run Stats',
        valueType: 'string',
        sub_category: 'Total Time'
    });
});

it('REDIRECTS_FILE_NAME_MAPPER maps multiple symbolic links and junctions correctly', () => {
    const input = [
      { file_type: 'SYMBOLIC_LINK', path: '/a/b.txt; ' },
      { file_type: 'SYMBOLIC_LINK', path: '/e/f.txt; ' },
      { file_type: 'JUNCTION', path: '/c/d.txt; ' },
      { file_type: 'JUNCTION', path: '/g/h.txt; ' },
      { file_type: 'VOLUME_MOUNT_POINT', path: '/c/d1.txt; ' },
      { file_type: 'VOLUME_MOUNT_POINT', path: '/g/h1.txt; ' },
      { file_type: 'SHORTCUT', path: '/c/d2.txt; ' },
      { file_type: 'SHORTCUT', path: '/g/h2.txt; ' }
    ];
  
    // Clean input: trim and remove trailing semicolon
    const cleanedInput = input.map(item => ({
      file_type: item.file_type,
      path: item.path.trim().replace(/;$/, ''),
    }));
  
    const result = REDIRECTS_FILE_NAME_MAPPER(cleanedInput);
  
    expect(result).toEqual([
      {
        value: '/a/b.txt; /e/f.txt',
        category: 'Redirects',
        valueType: 'string',
        sub_category: 'Symbolic Links'
      },
      {
        value: '/c/d.txt; /g/h.txt',
        category: 'Redirects',
        valueType: 'string',
        sub_category: 'Junctions'
      },
      {
        value: '/c/d1.txt; /g/h1.txt',
        category: 'Redirects',
        valueType: 'string',
        sub_category: 'Volume Mount Points'
      },
      {
        value: '/c/d2.txt; /g/h2.txt',
        category: 'Redirects',
        valueType: 'string',
        sub_category: 'Shortcuts'
      }
    ]);
  });

it('EEXIST_ERRORS_MAPPER maps input correctly', () => {
    const input = [
        { 
            parent_path: '/home/user/documents', 
            file_paths: ['FILE.txt', 'file.txt', 'File.TXT'] 
        },
        { 
            parent_path: '/home/user/images', 
            file_paths: ['IMAGE.jpg', 'image.JPG'] 
        }
    ];
    const result = EEXIST_ERRORS_MAPPER(input as any);
    expect(result).toEqual([
        {
            value: '/home/user/documents (FILE.txt, file.txt, File.TXT); /home/user/images (IMAGE.jpg, image.JPG)',
            category: 'Case Sensitivity Conflicts',
            valueType: 'string',
            sub_category: 'EEXIST Errors'
        }
    ]);
});

it('EEXIST_ERRORS_MAPPER handles empty input array', () => {
    const input: any[] = [];
    const result = EEXIST_ERRORS_MAPPER(input);
    expect(result).toEqual([
        {
            value: '',
            category: 'Case Sensitivity Conflicts',
            valueType: 'string',
            sub_category: 'EEXIST Errors'
        }
    ]);
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