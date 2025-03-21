import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }
  onModuleInit() {
    // setInterval(() => {
    //   const memoryUsage = process.memoryUsage();
    //   // console.log('Memory Usage:', {
    //   //   rss: `${this.bytesToMB(memoryUsage.rss)} MB`, // Resident Set Size
    //   //   heapTotal: `${this.bytesToMB(memoryUsage.heapTotal)} MB`, // Total Heap Size
    //   //   heapUsed: `${this.bytesToMB(memoryUsage.heapUsed)} MB`, // Used Heap Size
    //   //   external: `${this.bytesToMB(memoryUsage.external)} MB`, // External Memory (C++ objects)
    //   // });
    // }, 20000); // Log memory usage every 5 seconds
  }

  // private bytesToMB(bytes: number): string {
  //   return (bytes / 1024 / 1024).toFixed(2);
  // }
}
