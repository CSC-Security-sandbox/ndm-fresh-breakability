export const filePathValidation = (filePath: string) => {
    return filePath.replace(/[^a-zA-Z0-9._-]/g, '');
}
