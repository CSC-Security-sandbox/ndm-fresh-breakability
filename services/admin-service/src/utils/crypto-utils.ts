import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Logger } from '@nestjs/common';

/**
 * Decrypts encrypted data using AES-256-CTR algorithm
 * @param encryptedWithIv String with format "iv:encryptedData"
 * @returns Decrypted string
 * @throws Error if decryption fails
 */
export const decryptData = (encryptedWithIv: string): string => {
    try {
        const [ivHex, encryptedPassword] = encryptedWithIv.split(':');
        if (!ivHex || !encryptedPassword) {
            Logger.error("Encrypted data format is invalid. Expected 'iv:encryptedData'");
            throw new Error('An internal error occurred');
        }
        const iv = Buffer.from(ivHex, 'hex');
        const keyString = process.env.KEYCLOAK_CLIENT_SECRET;
        if (!keyString) {
            Logger.error('Missing encryption key in environment variables');
            throw new Error('An internal error occurred');
        }
        const key = createHash('sha256').update(keyString).digest();
        const decipher = createDecipheriv('aes-256-ctr', key, iv);
        let decrypted = decipher.update(encryptedPassword, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        Logger.error('Decryption failed:', error);
        throw new Error('An internal error occurred');
    }
};

/**
 * Encrypts data using AES-256-CTR algorithm
 * @param plaintext String to encrypt
 * @returns Encrypted string with format "iv:encryptedData"
 * @throws Error if encryption fails
 */
export const encryptData = (plaintext: string): string => {
    try {
        const iv = randomBytes(16);
        const keyString = process.env.KEYCLOAK_CLIENT_SECRET;
        if (!keyString) {
            Logger.error('Missing encryption key in environment variables');
            throw new Error('An internal error occurred');
        }
        const key = createHash('sha256').update(keyString).digest();
        const cipher = createCipheriv('aes-256-ctr', key, iv);
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return `${iv.toString('hex')}:${encrypted}`;
    } catch (error) {
        Logger.error('Encryption failed:', error);
        throw new Error('An internal error occurred');
    }
};