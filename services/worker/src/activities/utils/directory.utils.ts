import * as fs from 'fs';
import * as path from 'path';
import { E8Dot3CollisionError } from '../../errors/errors.types';

export async function createDirectoryWithTildeCheck(targetPath: string): Promise<void> {
   const pathParts = targetPath.split(path.sep);
    const tildeIndices: number[] = [];
    pathParts.forEach((part, index) => {
        if (part.includes('~')) {
            tildeIndices.push(index);
            console.log(`Found tilde directory at index ${index}: "${part}"`);
        }
    });
    console.log(`Found tildes at indices: [${tildeIndices.join(', ')}]`);
    
    let lastTildeIndex = -1;
    
    // Process each tilde directory: mkdir -> check realpath -> continue
    for (const tildeIndex of tildeIndices) {
        const pathUpToTilde = pathParts.slice(0, tildeIndex + 1).join(path.sep);
        const tildeDirectoryName = pathParts[tildeIndex];
        
        console.log(`mkdir: ${pathUpToTilde}`);
        await fs.promises.mkdir(pathUpToTilde, {recursive: true});
        
        console.log(`checking realpath: ${pathUpToTilde}`);
        try {
            await fs.promises.realpath(pathUpToTilde);
            console.log(`Realpath success for: ${tildeDirectoryName}`);
        } catch (error) {
            throw E8Dot3CollisionError.forDirectory(pathUpToTilde);
        }
        
        lastTildeIndex = tildeIndex;
    }
    
    if (lastTildeIndex < pathParts.length - 1) {
        const remainingParts = pathParts.slice(lastTildeIndex + 1);
        const remainingPath = remainingParts.join(path.sep);
        const basePath = pathParts.slice(0, lastTildeIndex + 1).join(path.sep);
        const fullRemainingPath = path.join(basePath, remainingPath);
        
        console.log(`mkdir remaining: ${fullRemainingPath}`);
        await fs.promises.mkdir(fullRemainingPath, {recursive: true});
    }
}