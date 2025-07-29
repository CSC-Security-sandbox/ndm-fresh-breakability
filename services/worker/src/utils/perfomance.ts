import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const logToFile = (message: string) => {
  const logsDir = join(process.cwd(), 'logs');
  
  // Ensure logs directory exists
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
  
  const logPath = join(logsDir, 'performance.log');
  const timestamp = new Date().toISOString();
  appendFileSync(logPath, `${timestamp} - ${message}\n`);
};

export function LogExecutionTime(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor,
) {
  const originalMethod = descriptor.value;
  const className = target.constructor.name;
  
  descriptor.value = function (...args: any[]) {
    const start = performance.now();
    logToFile(`[TIMING] ${className}.${propertyKey} - Start time: ${new Date().toISOString()}`);
    
    const result = originalMethod.apply(this, args);
    
    if (result instanceof Promise) {
      return result
        .then((res) => {
          const executionTime = (performance.now() - start).toFixed(3);
          logToFile(`[TIMING] ${className}.${propertyKey} - End time: ${new Date().toISOString()}, Total execution time: ${executionTime}ms`);
          return res;
        })
        .catch((error) => {
          const executionTime = (performance.now() - start).toFixed(3);
          logToFile(`[TIMING] ${className}.${propertyKey} - End time (error): ${new Date().toISOString()}, Total execution time: ${executionTime}ms`);
          throw error;
        });
    } else {
      const executionTime = (performance.now() - start).toFixed(3);
      logToFile(`[TIMING] ${className}.${propertyKey} - End time: ${new Date().toISOString()}, Total execution time: ${executionTime}ms`);
      return result;
    }
  };
  return descriptor;
}