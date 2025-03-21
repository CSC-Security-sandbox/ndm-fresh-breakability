import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  onModuleInit() {
  setInterval(() => {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const loadAverage = require("os").loadavg();
    const uptime = process.uptime();
    const pid = process.pid;

    console.log(`\n--- Process Monitoring (PID: ${pid}) ---`);
    console.log("Memory Usage:", {
      rss: `${this.bytesToMB(memoryUsage.rss)} MB`, // Resident Set Size
      heapTotal: `${this.bytesToMB(memoryUsage.heapTotal)} MB`, // Total Heap Size
      heapUsed: `${this.bytesToMB(memoryUsage.heapUsed)} MB`, // Used Heap Size
      external: `${this.bytesToMB(memoryUsage.external)} MB`, // External Memory
    });

    console.log("CPU Usage:", {
      user: `${(cpuUsage.user / 1e6).toFixed(2)} ms`, // User CPU time in milliseconds
      system: `${(cpuUsage.system / 1e6).toFixed(2)} ms`, // System CPU time in milliseconds
    });

    console.log("System Load Average (1, 5, 15 min):", loadAverage.map(avg => avg.toFixed(2)).join(", "));
    console.log(`Process Uptime: ${uptime.toFixed(2)} seconds`);
    
  }, 20000); // Log every 20 seconds
}

private bytesToMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}
}
