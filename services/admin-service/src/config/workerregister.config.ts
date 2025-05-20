import { registerAs } from '@nestjs/config';

export type WorkerRegisterConfig = {
  controlPlaneIp: string;
};

export default registerAs(
  'workerRegister',
  (): WorkerRegisterConfig => ({
    controlPlaneIp: process.env.CONTROL_PLANE_IP || 'localhost',
  }),
);
