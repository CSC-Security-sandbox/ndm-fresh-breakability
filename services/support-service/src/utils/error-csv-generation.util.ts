import { OperationErrorExportData } from "src/constants/types";

export function getProjectIds({ payload }): string[] {
    return payload.projectWorkerMap
        .map(entry => entry.projectId)
        .filter(Boolean);
}

/**
    * Group operation errors by project ID and date
    */
export function groupDataByProjectAndDate(
    data: OperationErrorExportData[],
): Map<string, Map<string, OperationErrorExportData[]>> {
    const grouped = new Map<string, Map<string, OperationErrorExportData[]>>();

    for (const item of data) {
        // Properly format date to YYYY-MM-DD
        let date: string;
        try {
            // Handle both Date objects and string dates
            const dateObj = new Date(item.createdAt);
            if (isNaN(dateObj.getTime())) {
                // If invalid date, try to extract from string manually
                date = item.createdAt.toString().substring(0, 10);
            } else {
                // Format as YYYY-MM-DD
                date = dateObj.toISOString().split('T')[0];
            }
        } catch (error) {
            // Fallback: try to extract date string manually
            const dateStr = item.createdAt.toString();
            if (dateStr.includes('-')) {
                date = dateStr.split('T')[0];
            } else {
                // For dates like "Fri Jul 11 2025", parse and format
                const parsed = new Date(dateStr);
                date = parsed.toISOString().split('T')[0];
            }
        }

        const projectId = item.projectId;

        if (!grouped.has(projectId)) {
            grouped.set(projectId, new Map());
        }

        const projectGroup = grouped.get(projectId)!;
        if (!projectGroup.has(date)) {
            projectGroup.set(date, []);
        }

        projectGroup.get(date)!.push(item);
    }

    return grouped;
}

/**
* Format date/time for CSV display
*/
export function formatDateTime(dateInput: any): string {
    try {
        let date: Date;

        if (dateInput instanceof Date) {
            date = dateInput;
        } else if (typeof dateInput === 'string') {
            date = new Date(dateInput);
        } else {
            // Handle other formats
            date = new Date(dateInput);
        }

        // Check if date is valid
        if (isNaN(date.getTime())) {
            return dateInput?.toString() || '';
        }

        // Format as YYYY-MM-DD HH:mm:ss
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');

        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    } catch (error) {
        // Fallback to original value if formatting fails
        return dateInput?.toString() || '';
    }
}