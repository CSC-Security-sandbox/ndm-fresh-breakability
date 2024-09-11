import { Socket } from "socket.io";
import { WsJwtGuard } from "./ws-jwt/ws-jwt.guard";
import mongoose from "mongoose";

type SocketMiddleware = (
    socket: Socket,
    next: (err?: Error) => void,
  ) => void;

export const SockateAuthMiddleware  = () : SocketMiddleware=> {
    return async (client, next)  => {
        try {
            // WsJwtGuard.validate(client)
            const  projectId = client.handshake.query?.projectId as string
            const isValid = mongoose.Types.ObjectId.isValid(projectId);
            if(!isValid) throw new Error(`Invalid Project Details ${projectId}`)
            next() 
        }catch(error) {
            next(new Error(error.message));
        }
    }
}