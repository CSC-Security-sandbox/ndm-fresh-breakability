import * as crypto from "crypto";

export const  calculateHash = (list: string[]): string => {
  const concatenatedIds = list.slice().sort().join(',');
  return crypto.createHash('sha256').update(concatenatedIds).digest('hex');
}

//TODO: understand the performance implications of using crypto.createHash vs a simple hash function
export const calculateHashFast = (list: string[]): string => {
  let hash = 0;
  for (const item of list) {
    hash = ((hash << 5) - hash + simpleHash(item)) | 0; // 32-bit hash
  }
  return hash.toString(16); // Convert to hex
};

function simpleHash(item: string): number {
  let hash = 0;
  for (let i = 0; i < item.length; i++) {
    hash = (hash << 5) - hash + item.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  return hash;
}