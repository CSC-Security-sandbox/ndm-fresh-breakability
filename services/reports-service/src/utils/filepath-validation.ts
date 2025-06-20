
export const filePathValidation = (filePath: string) : boolean => {
    const sanitizedPath = filePath.replace(/[^a-zA-Z0-9._-]/g, '');
    return sanitizedPath === filePath;
}
