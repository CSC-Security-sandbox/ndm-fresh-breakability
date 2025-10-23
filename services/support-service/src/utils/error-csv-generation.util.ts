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
        // Extract date in YYYY-MM-DD format
        // Since createdAt is already a string (likely ISO format), convert to Date then extract date part
        const dateObj = new Date(item.createdAt);

        // Check if the date is valid
        if (isNaN(dateObj.getTime())) {
            console.warn(`Invalid date found for item ${item.id}: ${item.createdAt}`);
            continue; // Skip items with invalid dates
        }

        const date = dateObj.toISOString().split('T')[0];
        const projectId = item.projectId;

        // Get or create project group
        let projectGroup = grouped.get(projectId);
        if (!projectGroup) {
            projectGroup = new Map<string, OperationErrorExportData[]>();
            grouped.set(projectId, projectGroup);
        }

        // Get or create date group
        let dateGroup = projectGroup.get(date);
        if (!dateGroup) {
            dateGroup = [];
            projectGroup.set(date, dateGroup);
        }

        dateGroup.push(item);
    }

    return grouped;
}

/**
 * Format date/time for CSV display
 * Accepts both Date objects and ISO format strings
 */
export function formatDateTime(dateInput: string | Date): string {
    if (!dateInput) {
        return '';
    }

    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);

    if (isNaN(date.getTime())) {
        throw new Error(`Invalid date format: ${dateInput}`);
    }

    // Use UTC methods to ensure consistent formatting regardless of timezone
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const seconds = String(date.getUTCSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}