import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const ClientIp = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const clientIp = request.headers['x-forwarded-for'] || request.socket.remoteAddress;
    return Array.isArray(clientIp) ? clientIp[0] : clientIp;
  },
);
