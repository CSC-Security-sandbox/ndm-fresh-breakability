
import * as fs from "fs";
import { getChecksum, removePrefix } from "./base";
import * as path from "path";

function* getDirectoryContents(path: string): Generator<string> {
    if(!fs.existsSync(path)) return
    try {
        const items = fs.readdirSync(path, { withFileTypes: true });
        for (const item of items) {
            yield item.name;
        }
    } catch (error) {
        console.error("Error reading directory:", error);
    }
}

const syncContent = async (sourcePath: string, targetPath: string, sourcePrefix: string) => {
    const files: string[] = [];
    const directory: string[] = [];
    try{
        const sourceContent = new Set<string>(await getDirectoryContents(sourcePath))
        const targeContent = new Set<string>(await getDirectoryContents(targetPath))
        for(const item of sourceContent) {
            const sourceContentPath = path.join(sourcePath, item);
            if(!fs.existsSync(sourceContentPath)) 
                continue
            const sourceContent = fs.statSync(sourceContentPath)
            const relativeSourcePath =  removePrefix(sourceContentPath, sourcePrefix)
            if(sourceContent.isDirectory())
                directory.push(relativeSourcePath)
            else if(!targeContent.has(item)) 
                files.push(relativeSourcePath)
            else {
                const targetFilePath = path.join(targetPath, item);
                const targetFile = fs.statSync(targetFilePath)
                if(fs.existsSync(targetFilePath) && targetFile.isFile()) 
                try {
                    const [checksum1, checksum2] = await Promise.all([
                        getChecksum(sourceContentPath),
                        getChecksum(targetFilePath)
                    ]);
                    if (checksum1 !== checksum2) {
                        files.push(relativeSourcePath);
                    }
                } catch (error) {
                    console.error("Error computing checksum:", error);
                }
            }
        }
    }catch(error) {
        console.error(error);
    }
    return {files, directory};
}

// const dir1 = "/Users/calfus-kunalavghade/Desktop/node-fs/test1";
// const dir2 = "/Users/calfus-kunalavghade/Desktop/node-fs/test3";

// const prefix = "/Users/calfus-kunalavghade/Desktop/node-fs";

// syncContent(dir1, dir2, prefix)
//     .then(diff => console.log("Differences:", diff.files , diff.directory))
//     .catch(err => console.error("Error:", err));
