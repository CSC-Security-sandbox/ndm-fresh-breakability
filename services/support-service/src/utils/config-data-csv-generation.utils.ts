// Escapes a CSV value by wrapping it in quotes if it contains special characters
export function escapeCsvValue(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Escapes an entire row of CSV values
export function escapeRow(values: string[]): string {
  return values.map((value) => escapeCsvValue(value)).join(',');
}

//Creates a CSV string from headers and data
export function createCsvString(
  headers: string[],
  data: Record<string, any>[],
): string {
  const friendlyHeaders = headers.map((header) => makeHeaderFriendly(header));

  let csvContent = escapeRow(friendlyHeaders) + '\n';

  data.forEach((row) => {
    const values = headers.map((header) => {
      const value = String(row[header] || '');
      return escapeCsvValue(value);
    });
    csvContent += values.join(',') + '\n';
  });

  return csvContent;
}

//Transforms a header string to be more human-readable
export function makeHeaderFriendly(header: string): string {
  return header
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase to spaces
    .replace(/[_-]/g, ' ') // underscores/dashes to spaces
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .trim();
}
