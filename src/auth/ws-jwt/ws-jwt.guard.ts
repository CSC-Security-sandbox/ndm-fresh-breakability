import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { verify } from 'jsonwebtoken';
import { Observable } from 'rxjs';
import { Socket } from 'socket.io';

@Injectable()
export class WsJwtGuard implements CanActivate {

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    if(context.getType() !== 'ws') return true 
    const client : Socket = context.switchToWs().getClient()
    // WsJwtGuard.validate(client)
    return true;
  }

  static validate(client: Socket) {
    const { authorization  } = client.handshake.headers;
    Logger.log({authorization})
    const token: string = authorization.split(' ')[1]
    const payload =  verify(token, 'code')
    Logger.log(payload)
    return payload
  }
}
