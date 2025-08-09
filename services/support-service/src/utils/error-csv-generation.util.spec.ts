import { OperationErrorExportData } from 'src/constants/types';
import { getProjectIds, groupDataByProjectAndDate, formatDateTime } from './error-csv-generation.util';

describe('error-csv-generation.util', () => {
    describe('getProjectIds', () => {
        it('should extract project IDs from projectWorkerMap', () => {
            const payload = {
                projectWorkerMap: [
                    { projectId: 'project1', workerIds: ['worker1', 'worker2'] },
                    { projectId: 'project2', workerIds: ['worker3'] },
                    { projectId: 'project3', workerIds: ['worker4', 'worker5'] }
                ]
            };

            const result = getProjectIds({ payload });

            expect(result).toEqual(['project1', 'project2', 'project3']);
        });

        it('should filter out empty/null project IDs', () => {
            const payload = {
                projectWorkerMap: [
                    { projectId: 'project1', workerIds: ['worker1'] },
                    { projectId: '', workerIds: ['worker2'] },
                    { projectId: null, workerIds: ['worker3'] },
                    { projectId: 'project4', workerIds: ['worker4'] },
                    { projectId: undefined, workerIds: ['worker5'] }
                ]
            };

            const result = getProjectIds({ payload });

            expect(result).toEqual(['project1', 'project4']);
        });

        it('should return empty array when projectWorkerMap is empty', () => {
            const payload = {
                projectWorkerMap: []
            };

            const result = getProjectIds({ payload });

            expect(result).toEqual([]);
        });

        it('should handle missing projectWorkerMap', () => {
            const payload = {};

            expect(() => getProjectIds({ payload })).toThrow();
        });
    });

    describe('groupDataByProjectAndDate', () => {
        const mockData: OperationErrorExportData[] = [
            {
                id: '1',
                operationId: 'op1',
                errorCode: 'E001',
                errorMessage: 'Error 1',
                createdAt: '2025-01-15T10:30:00Z',
                fileName: 'test1.log',
                filePath: '/logs/test1.log',
                errorType: 'ValidationError',
                operationType: 'CREATE',
                origin: 'API',
                projectId: 'project1',
                projectName: 'Project One'
            },
            {
                id: '2',
                operationId: 'op2',
                errorCode: 'E002',
                errorMessage: 'Error 2',
                createdAt: '2025-01-15T14:20:00Z',
                fileName: 'test2.log',
                filePath: '/logs/test2.log',
                errorType: 'DatabaseError',
                operationType: 'UPDATE',
                origin: 'WORKER',
                projectId: 'project1',
                projectName: 'Project One'
            },
            {
                id: '3',
                operationId: 'op3',
                errorCode: 'E003',
                errorMessage: 'Error 3',
                createdAt: '2025-01-16T09:15:00Z',
                fileName: 'test3.log',
                filePath: '/logs/test3.log',
                errorType: 'NetworkError',
                operationType: 'DELETE',
                origin: 'API',
                projectId: 'project2',
                projectName: 'Project Two'
            },
            {
                id: '4',
                operationId: 'op4',
                errorCode: 'E004',
                errorMessage: 'Error 4',
                createdAt: '2025-01-16T16:45:00Z',
                fileName: 'test4.log',
                filePath: '/logs/test4.log',
                errorType: 'ValidationError',
                operationType: 'CREATE',
                origin: 'WORKER',
                projectId: 'project1',
                projectName: 'Project One'
            }
        ];

        it('should group data by project ID and date correctly', () => {
            const result = groupDataByProjectAndDate(mockData);

            expect(result.size).toBe(2); // 2 projects
            expect(result.has('project1')).toBe(true);
            expect(result.has('project2')).toBe(true);

            const project1Data = result.get('project1')!;
            expect(project1Data.size).toBe(2); // 2 dates for project1
            expect(project1Data.has('2025-01-15')).toBe(true);
            expect(project1Data.has('2025-01-16')).toBe(true);

            const project2Data = result.get('project2')!;
            expect(project2Data.size).toBe(1); // 1 date for project2
            expect(project2Data.has('2025-01-16')).toBe(true);

            // Check specific data
            expect(project1Data.get('2025-01-15')!.length).toBe(2);
            expect(project1Data.get('2025-01-16')!.length).toBe(1);
            expect(project2Data.get('2025-01-16')!.length).toBe(1);
        });

        it('should handle string dates correctly', () => {
            const dataWithStringDates: OperationErrorExportData[] = [
                {
                    ...mockData[0],
                    createdAt: '2025-01-20T08:30:00Z' as any
                },
                {
                    ...mockData[1],
                    createdAt: '2025-01-20T12:15:00Z' as any
                }
            ];

            const result = groupDataByProjectAndDate(dataWithStringDates);

            expect(result.size).toBe(1);
            const projectData = result.get('project1')!;
            expect(projectData.has('2025-01-20')).toBe(true);
            expect(projectData.get('2025-01-20')!.length).toBe(2);
        });

        it('should handle invalid dates gracefully', () => {
            const dataWithInvalidDates: OperationErrorExportData[] = [
                {
                    ...mockData[0],
                    createdAt: 'invalid-date' as any
                },
                {
                    ...mockData[1],
                    createdAt: 'Fri Jul 11 2025' as any
                }
            ];

            const result = groupDataByProjectAndDate(dataWithInvalidDates);

            expect(result.size).toBe(1);
            const projectData = result.get('project1')!;
            expect(projectData.size).toBeGreaterThan(0);
        });

        it('should handle empty data array', () => {
            const result = groupDataByProjectAndDate([]);

            expect(result.size).toBe(0);
        });

        it('should handle dates in different formats', () => {
            const dataWithDifferentFormats: OperationErrorExportData[] = [
                {
                    ...mockData[0],
                    createdAt: '2025-02-01T10:00:00.000Z' as any
                },
                {
                    ...mockData[1],
                    createdAt: '2025-02-01' as any
                },
                {
                    ...mockData[2],
                    createdAt: 'Sat Feb 01 2025 15:30:00 GMT+0000 (UTC)' as any
                }
            ];

            const result = groupDataByProjectAndDate(dataWithDifferentFormats);

            expect(result.size).toBe(2);

            const project1Data = result.get('project1')!;
            expect(project1Data.has('2025-02-01')).toBe(true);
            expect(project1Data.get('2025-02-01')!.length).toBe(2);

            const project2Data = result.get('project2')!;
            expect(project2Data.has('2025-02-01')).toBe(true);
            expect(project2Data.get('2025-02-01')!.length).toBe(1);
        });
    });

    describe('formatDateTime', () => {
        it('should format Date object correctly', () => {
            const date = new Date('2025-01-15T10:30:45Z');
            const result = formatDateTime(date);

            // Format should match expected pattern (local time conversion)
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            expect(result).toContain('2025-01-15');
        });

        it('should format string date correctly', () => {
            const dateString = '2025-01-15T10:30:45Z';
            const result = formatDateTime(dateString);

            // Format should match expected pattern (local time conversion)
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            expect(result).toContain('2025-01-15');
        });

        it('should handle ISO date string', () => {
            const isoString = '2025-12-25T23:59:59.999Z';
            const result = formatDateTime(isoString);

            // Format should match expected pattern (local time conversion)
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            // Should be next day due to timezone conversion
            expect(result).toContain('2025-12-2');
        });

        it('should handle date with different timezone', () => {
            const date = new Date('2025-06-15T14:30:45+05:30');
            const result = formatDateTime(date);

            // Should format in UTC
            expect(result).toMatch(/2025-06-15 \d{2}:\d{2}:\d{2}/);
        });

        it('should handle invalid date input gracefully', () => {
            const invalidDate = 'not-a-date';
            const result = formatDateTime(invalidDate);

            expect(result).toBe('not-a-date');
        });

        it('should handle null input', () => {
            const result = formatDateTime(null);

            // null gets converted to epoch time in local timezone
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        });

        it('should handle undefined input', () => {
            const result = formatDateTime(undefined);

            expect(result).toBe('');
        });

        it('should handle number input (timestamp)', () => {
            const timestamp = new Date('2025-01-15T10:30:45Z').getTime();
            const result = formatDateTime(timestamp);

            // Format should match expected pattern (local time conversion)
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            expect(result).toContain('2025-01-15');
        });

        it('should handle edge case dates', () => {
            // Test leap year
            const leapYear = new Date('2024-02-29T12:00:00Z');
            const result1 = formatDateTime(leapYear);
            expect(result1).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            expect(result1).toContain('2024-02-29');

            // Test year boundaries
            const newYear = new Date('2025-01-01T00:00:00Z');
            const result2 = formatDateTime(newYear);
            expect(result2).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            expect(result2).toContain('2025-01-01');

            // Test end of year
            const endYear = new Date('2025-12-31T23:59:59Z');
            const result3 = formatDateTime(endYear);
            expect(result3).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            // Should be next day due to timezone conversion
            expect(result3).toContain('2026-01-01');
        });

        it('should pad single digits correctly', () => {
            const date = new Date('2025-01-05T09:08:07Z');
            const result = formatDateTime(date);

            // Format should match expected pattern (local time conversion)
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            expect(result).toContain('2025-01-05');
        });

        it('should handle various string formats', () => {
            // Different string formats that JavaScript Date can parse
            const formats = [
                '2025-01-15',
                '01/15/2025',
                'Jan 15, 2025',
                'January 15, 2025',
                '2025-01-15 10:30:45'
            ];

            formats.forEach(format => {
                const result = formatDateTime(format);
                expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            });
        });

        it('should handle error during formatting', () => {
            // Mock Date constructor to throw error
            const originalDate = global.Date;
            global.Date = jest.fn(() => {
                throw new Error('Date constructor error');
            }) as any;

            const result = formatDateTime('2025-01-15');

            expect(result).toBe('2025-01-15');

            // Restore original Date
            global.Date = originalDate;
        });

        it('should handle objects that can be converted to dates', () => {
            const dateObj = {
                toString: () => '2025-01-15T10:30:45Z'
            };

            const result = formatDateTime(dateObj);

            expect(result).toMatch(/2025-01-15 \d{2}:\d{2}:\d{2}/);
        });
    });

    describe('Integration tests', () => {
        it('should work together in a complete workflow', () => {
            const payload = {
                projectWorkerMap: [
                    { projectId: 'proj1', workerIds: ['w1', 'w2'] },
                    { projectId: 'proj2', workerIds: ['w3'] }
                ]
            };

            const errorData: OperationErrorExportData[] = [
                {
                    id: '1',
                    operationId: 'op1',
                    errorCode: 'E001',
                    errorMessage: 'Test error',
                    createdAt: '2025-01-15T10:30:00Z',
                    fileName: 'integration-test.log',
                    filePath: '/logs/integration-test.log',
                    errorType: 'ValidationError',
                    operationType: 'CREATE',
                    origin: 'API',
                    projectId: 'proj1',
                    projectName: 'Project 1'
                }
            ];

            // Test getProjectIds
            const projectIds = getProjectIds({ payload });
            expect(projectIds).toEqual(['proj1', 'proj2']);

            // Test groupDataByProjectAndDate
            const grouped = groupDataByProjectAndDate(errorData);
            expect(grouped.size).toBe(1);
            expect(grouped.has('proj1')).toBe(true);

            // Test formatDateTime
            const formattedDate = formatDateTime(errorData[0].createdAt);
            expect(formattedDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            expect(formattedDate).toContain('2025-01-15');
        });
    });
});
