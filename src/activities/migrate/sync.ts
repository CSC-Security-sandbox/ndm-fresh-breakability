
import * as fs from "fs";
import { getChecksum } from "./base";
import * as path from "path";

function* getDirectoryContents(dir: string): Generator<string> {
    try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
            yield item.name;
        }
    } catch (error) {
        console.error("Error reading directory:", error);
    }
}

const syncContent = async (sourcePath: string, targetPath: string) => {
    const diff : string[] = [];
    try{
        const sourceContent = new Set<string>(await getDirectoryContents(sourcePath))
        const targeContent = new Set<string>(await getDirectoryContents(targetPath))

        for(const item of sourceContent) {
            const sourceContentPath = path.join(sourcePath, item);
            if(!fs.existsSync(sourceContentPath)) continue
            const sourceContent = fs.statSync(sourceContentPath)
            if(!targeContent.has(item) || sourceContent.isDirectory())
                diff.push(sourceContentPath)
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
                        diff.push(sourceContentPath);
                    }
                } catch (error) {
                    console.error("Error computing checksum:", error);
                }
            }
        }
    }catch(error) {
        console.error(error);
    }
    return diff;
}

// const dir1 = "/Users/calfus-kunalavghade/Desktop/node-fs/test1";
// const dir2 = "/Users/calfus-kunalavghade/Desktop/node-fs/test2";

// syncContent(dir1, dir2)
//     .then(diff => console.log("Differences:", diff))
//     .catch(err => console.error("Error:", err));
