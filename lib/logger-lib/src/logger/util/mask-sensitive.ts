import { format } from 'winston';

export const maskIPs = (value: any): any => {
    // Optimized regex for IPv4 and IPv6 (without :: compression) to avoid catastrophic backtracking
    const ipRegex = /\b((?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3})\b|([a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}/g;
    if (typeof value === 'string') {
        return value.replace(ipRegex, 'IP******');
    } else if (typeof value === 'object' && value !== null) {
        for (const key of Object.keys(value)) {
            value[key] = maskIPs(value[key]);
        }
        return value;
    }
    return value;
};

export const getMaskingStage = (skipMask: boolean) => {
    return format((info) => {
        if (skipMask) 
            return info;

        info.message = maskIPs(info.message);
        info.stack = maskIPs(info.stack);

        return info;
    });
};
