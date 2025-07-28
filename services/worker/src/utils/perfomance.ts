// Enhanced decorator with performance.now() for better precision
export function LogExecutionTime(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor,
) {
  const originalMethod = descriptor.value;
  const className = target.constructor.name;
  
  descriptor.value = function (...args: any[]) {
    const start = performance.now();
    console.log(`[TIMING] ${className}.${propertyKey} - Start time: ${new Date().toISOString()}`);
    
    const result = originalMethod.apply(this, args);
    
    if (result instanceof Promise) {
      return result
        .then((res) => {
          const executionTime = (performance.now() - start).toFixed(3);
          console.log(`[TIMING] ${className}.${propertyKey} - End time: ${new Date().toISOString()}, Total execution time: ${executionTime}ms`);
          return res;
        })
        .catch((error) => {
          const executionTime = (performance.now() - start).toFixed(3);
          console.log(`[TIMING] ${className}.${propertyKey} - End time (error): ${new Date().toISOString()}, Total execution time: ${executionTime}ms`);
          throw error;
        });
    } else {
      const executionTime = (performance.now() - start).toFixed(3);
      console.log(`[TIMING] ${className}.${propertyKey} - End time: ${new Date().toISOString()}, Total execution time: ${executionTime}ms`);
      return result;
    }
  };
  return descriptor;
}
