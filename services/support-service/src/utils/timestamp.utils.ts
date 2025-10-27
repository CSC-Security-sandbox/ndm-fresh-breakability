/**
 * Converts Unix timestamp to readable date string)
 * @returns Readable date string (e.g., "Saturday, 9 August 2025 at 7:25 am")
 */
export function formatUnixTimestamp(timestamp: string | number): string {
  try {
    const numericTimestamp =
      typeof timestamp === 'string' ? parseFloat(timestamp) : timestamp;

    const date = new Date(numericTimestamp * 1000);
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(date);
  } catch (error: any) {
    console.warn(`Failed to convert timestamp ${timestamp}: ${error.message}`);
    return timestamp.toString();
  }
}
