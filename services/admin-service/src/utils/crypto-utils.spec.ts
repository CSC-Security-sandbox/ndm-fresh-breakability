import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { decryptData, encryptData } from './crypto-utils';

const originalEnv = process.env;

jest.mock('@nestjs/common', () => {
    return {
        ...jest.requireActual('@nestjs/common'),
        Logger: {
            error: jest.fn(),
        }
    };
});

jest.mock('crypto', () => {
    const actualCrypto = jest.requireActual('crypto');

    return {
        ...actualCrypto,
        createHash: jest.fn().mockImplementation(actualCrypto.createHash),
        createCipheriv: jest.fn().mockImplementation(actualCrypto.createCipheriv),
        createDecipheriv: jest.fn().mockImplementation(actualCrypto.createDecipheriv),
        randomBytes: jest.fn().mockImplementation(() => Buffer.from('0123456789abcdef0123456789abcdef', 'hex'))
    };
});

describe('Crypto Utils', () => {
    beforeEach(() => {
        process.env = { ...originalEnv };
        process.env.KEYCLOAK_CLIENT_SECRET = 'test-secret-key';
        jest.clearAllMocks();
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('encryptData', () => {
        it('should encrypt plaintext data correctly', () => {
            const plaintext = 'test-password';
            const encrypted = encryptData(plaintext);
            expect(encrypted).toContain(':'); // Should contain the IV separator
            expect(encrypted).not.toBe(plaintext); // Should not be the original text
            expect(encrypted.split(':').length).toBe(2); // Should have IV and encrypted parts
            expect(createCipheriv).toHaveBeenCalled();
        });

        it('should throw Error when env var is not set', () => {
            const plaintext = 'test-password';
            delete process.env.KEYCLOAK_CLIENT_SECRET;
            expect(() => encryptData(plaintext)).toThrow(Error);
            expect(createHash).not.toHaveBeenCalled();
        });

        it('should throw Error on encryption error', () => {
            const plaintext = 'test-password';
            jest.spyOn(require('crypto'), 'createCipheriv').mockImplementationOnce(() => {
                throw new Error('Encryption error');
            });

            expect(() => encryptData(plaintext)).toThrow(Error);
        });
    });

    describe('decryptData', () => {
        it('should decrypt encrypted data correctly', () => {
            const plaintext = 'test-password';
            const encrypted = encryptData(plaintext);
            const decrypted = decryptData(encrypted);
            expect(decrypted).toBe(plaintext);
            expect(createDecipheriv).toHaveBeenCalled();
        });

        it('should throw Error on invalid format', () => {
            const invalidEncrypted = 'invalid-format-without-separator';
            expect(() => decryptData(invalidEncrypted)).toThrow(Error);
        });

        it('should throw Error when env var is not set', () => {
            const encryptedData = '0123456789abcdef:someencrypteddata';
            delete process.env.KEYCLOAK_CLIENT_SECRET;
            expect(() => decryptData(encryptedData)).toThrow(Error);
        });

        it('should throw Error on decryption error', () => {
            const invalidEncrypted = '0123456789abcdef:invalidciphertext';
            expect(() => decryptData(invalidEncrypted)).toThrow(Error);
        });
    });

    describe('integration', () => {
        it('should decrypt what was encrypted', () => {
            const testData = [
                'simple password',
                'Complex P@$$w0rd!',
                '1234567890',
                'A longer text that might contain special characters @#$%^&*()'
            ];

            testData.forEach(original => {
                const encrypted = encryptData(original);
                const decrypted = decryptData(encrypted);

                expect(decrypted).toBe(original);
            });
        });
    });
});