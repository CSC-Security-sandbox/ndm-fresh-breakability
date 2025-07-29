// Enhanced decorator with Date.now() for Temporal workflow compatibility
// Can be used on class methods and standalone functions

// Overloaded function signatures for proper TypeScript support
import { join } from 'path';
import { appendFileSync, existsSync, mkdirSync } from 'fs';

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

export function LogExecutionTime<T extends (...args: any[]) => any>(fn: T): T;
export function LogExecutionTime(target: any, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor;
export function LogExecutionTime<T extends (...args: any[]) => any>(
    target: any,
    propertyKey?: string,
    descriptor?: PropertyDescriptor,
): T | PropertyDescriptor {
  // Case 1: Used as a method decorator on class methods
  if (propertyKey && descriptor) {
    const originalMethod = descriptor.value;
    const className = target.constructor.name;

    descriptor.value = function (...args: any[]) {
      const start = Date.now();
      logToFile(`[TIMING] ${className}.${propertyKey} - Start time: ${new Date().toISOString()}`);

      const result = originalMethod.apply(this, args);

      if (result instanceof Promise) {
        return result
            .then((res) => {
              const executionTime = (Date.now() - start).toFixed(3);
              logToFile(`[TIMING] ${className}.${propertyKey} - End time: ${new Date().toISOString()}, Total execution time: ${executionTime}ms`);
              return res;
            })
            .catch((error) => {
              const executionTime = (Date.now() - start).toFixed(3);
              logToFile(`[TIMING] ${className}.${propertyKey} - End time (error): ${new Date().toISOString()}, Total execution time: ${executionTime}ms`);
              throw error;
            });
      } else {
        const executionTime = (Date.now() - start).toFixed(3);
        logToFile(`[TIMING] ${className}.${propertyKey} - End time: ${new Date().toISOString()}, Total execution time: ${executionTime}ms`);
        return result;
      }
    };
    return descriptor;
  }

      // Case 2: Used as a function wrapper for standalone functions
  // target is actually the function in this case
  else {
    const originalFunction = target as T;
    const functionName = originalFunction.name || 'anonymous';

    const wrappedFunction = function (...args: any[]) {
      const start = Date.now()
      logToFile(`[TIMING] ${functionName} - Start time: ${new Date().toISOString()}`);

      const result = originalFunction.apply(this, args);

      if (result instanceof Promise) {
        return result
            .then((res) => {
              const executionTime = (Date.now() - start).toFixed(3);
              logToFile(`[TIMING] ${functionName} - End time: ${new Date().toISOString()}, Total execution time: ${executionTime}ms`);
              return res;
            })
            .catch((error) => {
              const executionTime = (Date.now() - start).toFixed(3);
              logToFile(`[TIMING] ${functionName} - End time (error): ${new Date().toISOString()}, Total execution time: ${executionTime}ms`);
              throw error;
            });
      } else {
        const executionTime = (Date.now() - start).toFixed(3);
        logToFile(`[TIMING] ${functionName} - End time: ${new Date().toISOString()}, Total execution time: ${executionTime}ms`);
        return result;
      }
    } as T;

    return wrappedFunction;
  }
} 