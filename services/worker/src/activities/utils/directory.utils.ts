import * as fs from 'fs';
import * as path from 'path';
import { E8Dot3CollisionError } from '../../errors/errors.types';
import { WINDOWS } from '../../config/app.config';

/**
 * Creates a directory path with 8.3 filename collision detection for Windows tilde directories.
 * 
 * Windows automatically generates 8.3 short names for long filenames using tilde notation (e.g., LONGDI~1).
 * When multiple files/folders share the same 6-character prefix, collisions can occur where:
 * - mkdir succeeds (directory is created)
 * - realpath fails with ENOENT or EBADF (directory is inaccessible due to short name conflict)
 * 
 * This function detects such collisions by:
 * 1. Creating each tilde directory incrementally
 * 2. Verifying accessibility with realpath after each mkdir
 * 3. Throwing E8Dot3CollisionError when collision is detected
 * 
 * @param targetPath - The full target path to create
 * @throws E8Dot3CollisionError when 8.3 collision is detected
 */
export async function createDirectory(targetPath: string): Promise<void> {
  // Create destination directory with collision detection
    if (process.platform === WINDOWS && targetPath.includes('~')) {
        const pathParts = targetPath.split(path.sep);
        const tildeIndices: number[] = [];
        
        // Find all directories with tilde characters (potential 8.3 short names)
        pathParts.forEach((part, index) => {
            if (part.includes('~')) {
                tildeIndices.push(index);
            }
        });
    
     // Process each tilde directory: mkdir -> check realpath -> continue
        for (const tildeIndex of tildeIndices) {
            const pathUpToTilde = pathParts.slice(0, tildeIndex + 1).join(path.sep);
            const tildeDirectoryName = pathParts[tildeIndex];
        
            // Attempt to create the tilde directory
            try {
                await fs.promises.mkdir(pathUpToTilde, {recursive: true});
            } catch (error: any) {
                // ENOENT during mkdir indicates parent path collision
                if (error.code === 'ENOENT') {
                    throw new E8Dot3CollisionError(pathUpToTilde);
                }
                throw error;
            }
            
            // Verify directory is accessible (detects collision even if mkdir succeeded)
            try {
                await fs.promises.realpath(pathUpToTilde);
                console.log(`Realpath success for: ${tildeDirectoryName}`);
            } catch (error: any) {
                // ENOENT or EBADF after successful mkdir indicates 8.3 collision
                if (error.code === 'ENOENT' || error.code === 'EBADF') {
                    throw new E8Dot3CollisionError(pathUpToTilde);
                }
                throw error;
            }
        }
        // Create any remaining directories after the last tilde directory
        const lastTildeIndex = tildeIndices[tildeIndices.length - 1];
        if (lastTildeIndex < pathParts.length - 1) {
            await fs.promises.mkdir(targetPath, {recursive: true});
        }
    } else {
        // No tildes or non-Windows: use regular mkdir
        await fs.promises.mkdir(targetPath, {recursive: true});
    }
}