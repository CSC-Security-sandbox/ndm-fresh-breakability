import { sanitize } from './utilities';
import { ProtocolPayload } from '../protocols/protocol/protocol.type'; 

describe('sanitize', () => {
    it('should replace sensitive fields in the message with the placeholder', () => {
        const message = 'User john_doe logged in with password john123';
        const payload: ProtocolPayload = { username: 'john_doe', password: 'john123', protocolVersion: '1.0' };
        const sanitizedMessage = sanitize(message, ["john_doe", "john123"]);
        expect(sanitizedMessage).toBe('User ****** logged in with password ******');
    });

    it('should replace sensitive fields in the message with the placeholder case insensitive', () => {
        const message = 'User john_doe logged in with password john123';
        const payload: ProtocolPayload = { username: 'john_doe', password: 'john123', protocolVersion: '1.0' };
        const sanitizedMessage = sanitize(message, ["john_doE", "john123"]);
        expect(sanitizedMessage).toBe('User ****** logged in with password ******');
    });

    it('should return the original message if no sensitive fields are found', () => {
        const message = 'No sensitive information here';
        const payload: ProtocolPayload = { username: 'john_doe', password: 'secret123', protocolVersion: '1.0' };
        const sanitizedMessage = sanitize(message, ["john_doe", "secret123"]);
        expect(sanitizedMessage).toBe(message);
    });

    it('should return the original message if payload is null or undefined', () => {
        const message = 'Message with no payload';
        const sanitizedMessage = sanitize(message, null as any);
        expect(sanitizedMessage).toBe(message);
    });

    it('should return the original message if message is null or undefined', () => {
        const payload: ProtocolPayload = { username: 'john_doe', password: 'secret123', protocolVersion: '1.0' };
        const sanitizedMessage = sanitize(null as any, ["john_doe", "secret123"]);
        expect(sanitizedMessage).toBe(null);
    });

    it('should use the custom placeholder if provided', () => {
        const message = 'User john_doe logged in with password secret123';
        const payload: ProtocolPayload = { username: 'john_doe', password: 'secret123', protocolVersion: '1.0' };
        const sanitizedMessage = sanitize(message, ["John_doe", "secret123"], '[REDACTED]');
        expect(sanitizedMessage).toBe('User [REDACTED] logged in with password [REDACTED]');
    });

    it('should not escape special characters in sensitive fields', () => {
        const message = 'User john.doe logged in with password U@%#%Nuko%Bmd&';
        const payload: ProtocolPayload = { username: 'john.doe', password: 'U@%#%Nuko%Bmd&', protocolVersion: '1.0' };
        const sanitizedMessage = sanitize(message, ["john.doe", "U@%#%Nuko%Bmd&"]);
        expect(sanitizedMessage).toBe('User ****** logged in with password ******');
    });

    it('should not escape special characters in sensitive fields', () => {
        const message = 'User john.doe logged in with password secret$123';
        const payload: ProtocolPayload = { username: 'john.doe', password: 'secret$123', protocolVersion: '1.0' };
        const sanitizedMessage = sanitize(message, ["john.doe", "secret$123"]);
        expect(sanitizedMessage).toBe('User ****** logged in with password ******');
    });
});