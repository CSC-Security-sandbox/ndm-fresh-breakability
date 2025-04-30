import { Transform } from 'class-transformer';

export function Trim() {
  return Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}


export const isWorkerHealthy = (updateAt:any, timeout: number):boolean => {
  const currentTime = new Date();
  const diffInSeconds = Math.floor(
    Math.abs(
      currentTime.getTime() - new Date(updateAt).getTime(),
    ) / 1000,
  );
  console.log('diffInSeconds', diffInSeconds, timeout);
  return diffInSeconds < timeout;
}