
import { ExecutionContext, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { verify } from 'jsonwebtoken';
import { WsJwtGuard } from './ws-jwt.guard';

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
}));

describe('WsJwtGuard', () => {
  let guard: WsJwtGuard;
  let context: Partial<ExecutionContext>;
  let client: Partial<Socket>;

  beforeEach(() => {
    guard = new WsJwtGuard();
    client = {
      handshake: {
        headers: {
          authorization: 'Bearer mock-token',
        },
        query: {},
        address: "",
        auth:{},
        issued: 1,
        secure: true,
        time: "",
        url: "",
        xdomain: false
      },
    };
    context = {
      getType: jest.fn().mockReturnValue('ws'),
      switchToWs: jest.fn().mockReturnValue({
        getClient: jest.fn().mockReturnValue(client),
      }),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('canActivate', () => {
    it('should return true for non-WS context', () => {
      (context.getType as jest.Mock).mockReturnValue('http'); 
      expect(guard.canActivate(context as ExecutionContext)).toBe(true);
    });

    it('should return true for WS context', () => {
      expect(guard.canActivate(context as ExecutionContext)).toBe(true);
    });
  });

  describe('validate', () => {
    it('should log the token and payload if token is valid', () => {
      const mockPayload = { userId: '12345' };
      (verify as jest.Mock).mockReturnValue(mockPayload);

      const logSpy = jest.spyOn(Logger, 'log').mockImplementation();
      WsJwtGuard.validate(client as Socket);

      expect(logSpy).toHaveBeenCalledWith({ authorization: 'Bearer mock-token' });
      expect(logSpy).toHaveBeenCalledWith(mockPayload);
      expect(verify).toHaveBeenCalledWith('mock-token', 'code');
    });

    it('should throw an error if token is missing', () => {
      client.handshake.headers.authorization = null;

      expect(() => WsJwtGuard.validate(client as Socket)).toThrowError();
    });

    it('should throw an error if token is invalid', () => {
      (verify as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      expect(() => WsJwtGuard.validate(client as Socket)).toThrowError('Invalid token');
    });
  });
});
