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
