import {
  escapeCsvValue,
  escapeRow,
  createCsvString,
  makeHeaderFriendly,
} from './config-data-csv-generation.utils';

describe('config-data-csv-generation.utils', () => {
  describe('escapeCsvValue', () => {
    it('should return the value unchanged if it contains no special characters', () => {
      const value = 'simple-value';
      const result = escapeCsvValue(value);
      expect(result).toBe('simple-value');
    });

    it('should wrap value in quotes if it contains comma', () => {
      const value = 'value,with,comma';
      const result = escapeCsvValue(value);
      expect(result).toBe('"value,with,comma"');
    });

    it('should wrap value in quotes if it contains double quotes', () => {
      const value = 'value"with"quotes';
      const result = escapeCsvValue(value);
      expect(result).toBe('"value""with""quotes"');
    });

    it('should wrap value in quotes if it contains newline', () => {
      const value = 'value\nwith\nnewline';
      const result = escapeCsvValue(value);
      expect(result).toBe('"value\nwith\nnewline"');
    });

    it('should handle value with multiple special characters', () => {
      const value = 'value,"with\nmultiple';
      const result = escapeCsvValue(value);
      expect(result).toBe('"value,""with\nmultiple"');
    });

    it('should handle empty string', () => {
      const value = '';
      const result = escapeCsvValue(value);
      expect(result).toBe('');
    });

    it('should handle value with only quotes', () => {
      const value = '"""';
      const result = escapeCsvValue(value);
      expect(result).toBe('""""""""');
    });

    it('should handle value with carriage return and newline', () => {
      const value = 'value\r\nwith\r\nCRLF';
      const result = escapeCsvValue(value);
      expect(result).toBe('"value\r\nwith\r\nCRLF"');
    });
  });

  describe('escapeRow', () => {
    it('should escape and join multiple values with commas', () => {
      const values = ['simple', 'value,with,comma', 'value"with"quotes'];
      const result = escapeRow(values);
      expect(result).toBe('simple,"value,with,comma","value""with""quotes"');
    });

    it('should handle empty array', () => {
      const values: string[] = [];
      const result = escapeRow(values);
      expect(result).toBe('');
    });

    it('should handle array with one value', () => {
      const values = ['single-value'];
      const result = escapeRow(values);
      expect(result).toBe('single-value');
    });

    it('should handle array with empty strings', () => {
      const values = ['', 'value', ''];
      const result = escapeRow(values);
      expect(result).toBe(',value,');
    });

    it('should handle array with special characters in multiple values', () => {
      const values = ['value\nwith\nnewline', 'value,comma', 'normal'];
      const result = escapeRow(values);
      expect(result).toBe('"value\nwith\nnewline","value,comma",normal');
    });
  });

  describe('makeHeaderFriendly', () => {
    it('should convert camelCase to friendly format', () => {
      const header = 'projectName';
      const result = makeHeaderFriendly(header);
      expect(result).toBe('Project Name');
    });

    it('should convert snake_case to friendly format', () => {
      const header = 'project_name';
      const result = makeHeaderFriendly(header);
      expect(result).toBe('Project Name');
    });

    it('should convert kebab-case to friendly format', () => {
      const header = 'project-name';
      const result = makeHeaderFriendly(header);
      expect(result).toBe('Project Name');
    });

    it('should handle mixed case with underscores and dashes', () => {
      const header = 'project_Name-ID';
      const result = makeHeaderFriendly(header);
      expect(result).toBe('Project Name Id');
    });

    it('should handle single word', () => {
      const header = 'project';
      const result = makeHeaderFriendly(header);
      expect(result).toBe('Project');
    });

    it('should handle all uppercase', () => {
      const header = 'PROJECT_NAME';
      const result = makeHeaderFriendly(header);
      expect(result).toBe('Project Name');
    });

    it('should handle empty string', () => {
      const header = '';
      const result = makeHeaderFriendly(header);
      expect(result).toBe('');
    });

    it('should handle string with only special characters', () => {
      const header = '_-_-_';
      const result = makeHeaderFriendly(header);
      expect(result).toBe('');
    });

    it('should handle complex camelCase with multiple capital letters', () => {
      const header = 'projectConfigID';
      const result = makeHeaderFriendly(header);
      expect(result).toBe('Project Config Id');
    });

    it('should handle numbers in header', () => {
      const header = 'project123Name';
      const result = makeHeaderFriendly(header);
      expect(result).toBe('Project123name');
    });

    it('should trim whitespace', () => {
      const header = '  project_name  ';
      const result = makeHeaderFriendly(header);
      expect(result).toBe('Project Name');
    });
  });

  describe('createCsvString', () => {
    it('should create CSV string with headers and data', () => {
      const headers = ['projectName', 'configId'];
      const data = [
        { projectName: 'Test Project', configId: '123' },
        { projectName: 'Another Project', configId: '456' },
      ];
      const result = createCsvString(headers, data);
      const expected =
        'Project Name,Config Id\nTest Project,123\nAnother Project,456\n';
      expect(result).toBe(expected);
    });

    it('should handle data with special characters', () => {
      const headers = ['name', 'description'];
      const data = [
        { name: 'Project, Inc.', description: 'A project with "quotes"' },
        { name: 'Simple Project', description: 'Line 1\nLine 2' },
      ];
      const result = createCsvString(headers, data);
      const expected =
        'Name,Description\n"Project, Inc.","A project with ""quotes"""\nSimple Project,"Line 1\nLine 2"\n';
      expect(result).toBe(expected);
    });

    it('should handle missing values in data', () => {
      const headers = ['name', 'description', 'optional'];
      const data = [
        { name: 'Project 1', description: 'Desc 1' },
        { name: 'Project 2', description: 'Desc 2', optional: 'Value' },
      ];
      const result = createCsvString(headers, data);
      const expected =
        'Name,Description,Optional\nProject 1,Desc 1,\nProject 2,Desc 2,Value\n';
      expect(result).toBe(expected);
    });

    it('should handle null and undefined values', () => {
      const headers = ['name', 'value1', 'value2'];
      const data = [{ name: 'Project', value1: null, value2: undefined }];
      const result = createCsvString(headers, data);
      const expected = 'Name,Value1,Value2\nProject,,\n';
      expect(result).toBe(expected);
    });

    it('should handle numeric values', () => {
      const headers = ['name', 'count', 'price'];
      const data = [
        { name: 'Item 1', count: 5, price: 19.99 },
        { name: 'Item 2', count: 0, price: 0 },
      ];
      const result = createCsvString(headers, data);
      const expected = 'Name,Count,Price\nItem 1,5,19.99\nItem 2,,\n';
      expect(result).toBe(expected);
    });

    it('should handle boolean values', () => {
      const headers = ['name', 'active', 'verified'];
      const data = [{ name: 'User 1', active: true, verified: false }];
      const result = createCsvString(headers, data);
      const expected = 'Name,Active,Verified\nUser 1,true,\n';
      expect(result).toBe(expected);
    });

    it('should handle empty data array', () => {
      const headers = ['name', 'value'];
      const data: Record<string, any>[] = [];
      const result = createCsvString(headers, data);
      const expected = 'Name,Value\n';
      expect(result).toBe(expected);
    });

    it('should handle empty headers array', () => {
      const headers: string[] = [];
      const data = [{ name: 'Test' }];
      const result = createCsvString(headers, data);
      const expected = '\n\n';
      expect(result).toBe(expected);
    });

    it('should handle object values by converting to string', () => {
      const headers = ['name', 'metadata'];
      const data = [
        {
          name: 'Project',
          metadata: { key: 'value', nested: { prop: 'test' } },
        },
      ];
      const result = createCsvString(headers, data);
      const expected = 'Name,Metadata\nProject,[object Object]\n';
      expect(result).toBe(expected);
    });

    it('should handle array values by converting to string', () => {
      const headers = ['name', 'tags'];
      const data = [{ name: 'Project', tags: ['tag1', 'tag2', 'tag3'] }];
      const result = createCsvString(headers, data);
      const expected = 'Name,Tags\nProject,"tag1,tag2,tag3"\n';
      expect(result).toBe(expected);
    });

    it('should handle complex scenario with all edge cases', () => {
      const headers = ['project_name', 'configID', 'description'];
      const data = [
        {
          project_name: 'Complex, "Project"',
          configID: 123,
          description: 'Multi-line\ndescription with "quotes"',
        },
        {
          project_name: 'Simple Project',
          configID: null,
          description: undefined,
        },
      ];
      const result = createCsvString(headers, data);
      const expected =
        'Project Name,Config Id,Description\n"Complex, ""Project""",123,"Multi-line\ndescription with ""quotes"""\nSimple Project,,\n';
      expect(result).toBe(expected);
    });
  });
});
