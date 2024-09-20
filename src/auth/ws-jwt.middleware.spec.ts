import { Socket } from "socket.io";
import { SockateAuthMiddleware } from "./ws-jwt.middleware";


describe('SocketAuthMiddleware', () => {
  let socket: Partial<Socket>;
  let next: jest.Mock;

  beforeEach(() => {
    socket = {
      handshake: {
        headers:{},
        query: {},
        address: "",
        auth:{},
        issued: 1,
        secure: true,
        time: "",
        url: "",
        xdomain: false
      }
    };
    next = jest.fn();
  });

  it('should call next without error when projectId is valid UUID', async () => {
    const projectId = '550e8400-e29b-41d4-a716-446655440000'; // Example valid UUID
    socket.handshake!.query = { projectId };

    const middleware = SockateAuthMiddleware();
    await middleware(socket as Socket, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('should call next with error when projectId is invalid UUID', async () => {
    const projectId = 'invalid-uuid';
    socket.handshake!.query = { projectId };

    const middleware = SockateAuthMiddleware();
    await middleware(socket as Socket, next);

    expect(next).toHaveBeenCalledWith(new Error(`Invalid Project Details ${projectId}`));
  });

  it('should call next with error when projectId is missing', async () => {
    socket.handshake!.query = {};

    const middleware = SockateAuthMiddleware();
    await middleware(socket as Socket, next);

    expect(next).toHaveBeenCalledWith(new Error('Invalid Project Details undefined'));
  });
});
