export const filePathValidation = (filePath: string) => {
    const sanitizedPath = filePath.replace(/[^a-zA-Z0-9._-]/g, '');
    return sanitizedPath === filePath;
}
