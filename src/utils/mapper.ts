


export const covertBytes = (bytes: number) : string =>{
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let size = bytes;
    let unitIndex = 0
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return size === Math.floor(size)
        ? `${size?.toFixed(0)} ${units[unitIndex]}`
        : `${size?.toFixed(2)} ${units[unitIndex]}`;
}

export const capitalize = (status: string): string => {
    return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  };