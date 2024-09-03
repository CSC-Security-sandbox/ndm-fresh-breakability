import { Socket } from "socket.io";
import { WsJwtGuard } from "./ws-jwt/ws-jwt.guard";

type SocketMiddleware = (
    socket: Socket,
    next: (err?: Error) => void,
  ) => void;

export const SockateAuthMiddleware  = () : SocketMiddleware=> {
    return async (client, next)  => {
        try {
            // WsJwtGuard.validate(client)
            next() 
        }catch(error) {
            
            next(new Error(error.message));
        }
    }
}