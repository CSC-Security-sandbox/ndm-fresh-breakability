import { SocketEvents } from "src/constants/status";

export interface NotifyWorkerPayload {
  workerId: string;
  socketEvents: SocketEvents;
  payload: any
}
  