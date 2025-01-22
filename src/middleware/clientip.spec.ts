import { ExecutionContext } from '@nestjs/common';
import { ClientIp } from './clientip';

describe('ClientIp Decorator', () => {
  const mockExecutionContext = (headers: Record<string, any>, remoteAddress?: string): ExecutionContext => ({
    switchToHttp: () => ({
      getRequest: () => ({
        headers,
        socket: { remoteAddress },
      }),
    }),
  } as unknown as ExecutionContext);

  it('should return the IP from the x-forwarded-for header if it exists', () => {
    const context = mockExecutionContext({ 'x-forwarded-for': '192.168.1.1' }, '127.0.0.1');
    const result = ClientIp(null, context);
    expect(result).toBe('192.168.1.1');
  });

  it('should return the first IP from the x-forwarded-for header if it contains multiple IPs', () => {
    const context = mockExecutionContext({ 'x-forwarded-for': '192.168.1.1, 192.168.1.2' }, '127.0.0.1');
    const result = ClientIp(null, context);
    expect(result).toBe('192.168.1.1');
  });

  it('should return the socket remoteAddress if x-forwarded-for is not present', () => {
    const context = mockExecutionContext({}, '127.0.0.1');
    const result = ClientIp(null, context);
    expect(result).toBe('127.0.0.1');
  });

  it('should handle empty headers and no remoteAddress gracefully', () => {
    const context = mockExecutionContext({}, undefined);
    const result = ClientIp(null, context);
    expect(result).toBeUndefined();
  });

  it('should return the first IP from x-forwarded-for if it is an array', () => {
    const context = mockExecutionContext({ 'x-forwarded-for': ['192.168.1.1', '192.168.1.2'] }, '127.0.0.1');
    const result = ClientIp(null, context);
    expect(result).toBe('192.168.1.1');
  });
});
