import * as crypto from "crypto";

export const  calculateHash = (list: string[]): string => {
  const concatenatedIds = list.sort().join(',');
  return crypto.createHash('sha256').update(concatenatedIds).digest('hex');
}
