import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const ClientIp = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();

    const xForwardedFor = request.headers['x-forwarded-for'];
    const xRealIp = request.headers['x-real-ip'];
    const cfConnectingIp = request.headers['cf-connecting-ip'];
    let clientIp;
    if (xForwardedFor) {      
      clientIp = xForwardedFor.split(',')[0].trim();
    } else if (xRealIp) {        
      clientIp = xRealIp;
    } else if (cfConnectingIp) {        
      clientIp = cfConnectingIp;
    } else {
      clientIp = request.connection.remoteAddress;
    }
    return Array.isArray(clientIp) ? clientIp[0] : clientIp;
  },
);
