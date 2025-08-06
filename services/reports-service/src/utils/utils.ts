const sanitizeHtml = require('sanitize-html');

export const validateFilePath = (filePath: string): boolean => {
  const sanitizedPath = filePath.replace(/[^a-zA-Z0-9./_-]/g, "");
  return sanitizedPath === filePath;
};

export const escapeCsvValue = (value: string): string => {
  if (value.includes(",") || value.includes("\n") || value.includes('"')) {
    // Escape double quotes and wrap the value in double quotes
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

export const sanitizeReportData = (obj: any): any => {
    if (typeof obj === 'string') {
      if (typeof sanitizeHtml === 'function') {
        const sanitized = sanitizeHtml(obj, { allowedTags: [], allowedAttributes: {} });
        return sanitized;
      } else {
        return obj;
      }
    } else if (Array.isArray(obj)) {
      return obj.map(item => sanitizeReportData(item));
    } else if (typeof obj === 'object' && obj !== null) {
      const entries = Object.entries(obj).map(([key, value]) => {
        return [key, sanitizeReportData(value)];
      });
      return Object.fromEntries(entries);
    }
    return obj;
}
