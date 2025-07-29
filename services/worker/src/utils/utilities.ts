// Utility function to sanitize sensitive information in a message
export function sanitize(
    message: string,
    sensitiveFields: string[],
    placeholder: string = '******'
): string {
    if (!message || !sensitiveFields || sensitiveFields.length === 0) {
        return message;
    }
    const sanitizedFields = sensitiveFields
        .filter(field => field && field.trim())
        .map(field => field.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    
    if (sanitizedFields.length === 0) {
        return message;
    }
    const regex = new RegExp(`(${sanitizedFields.join('|')})`, 'gi');
    return message.replace(regex, placeholder);
}
