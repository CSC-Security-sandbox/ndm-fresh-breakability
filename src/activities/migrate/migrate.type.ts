export interface SyncContentInput{
    sourcePath: string;
    targetPath: string;
    sourcePrefix: string;
    excludePatterns: string[]
}

export interface SyncContentOutput{
    files: string[],
    directory: string[]
}