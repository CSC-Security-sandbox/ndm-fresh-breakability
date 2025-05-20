export interface HealthcheckPayload {
  workerId: string;
  healthStatus: string;
  systemStats: SystemStats;
}

export interface SystemStats {
  cpuUsage: string;
  memoryUsage: string;
  memoryLimit: string;
  diskUsage: string;
  diskLimit: string;
}

export enum HealthStatus {
  Healthy = 'HEALTHY',
  Unhealthy = 'UNHEALTHY',
}
