import * as fs from "fs";


export const validateStale = async (paths: string[]) => {
    for (const path of paths) {
        if(!path) continue
        console.log(`Validating path: ${path}`);
        try {
            await Promise.race([
                fs.promises.access(path, fs.constants.R_OK),
                new Promise((_, reject) => {
                    const timeoutId = setTimeout(() => reject(new Error('Timeout')), 1000);
                    // Unref the timeout to allow Node.js to exit
                    if (timeoutId.unref) {
                        timeoutId.unref();
                    }
                    return () => clearTimeout(timeoutId);
                })
            ]);
            console.log(`Path ${path} is valid.`);
        } catch (err) {
            console.error(`Path ${path} does not exist or is stale.`);
            throw new Error(`Path ${path} does not exist or is stale.`);
        }
    }
}