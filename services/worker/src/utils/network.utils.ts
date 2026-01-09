import { networkInterfaces } from 'os';

/**
 * Get the local IPv4 address of the worker
 * Prioritizes non-internal (non-127.x.x.x, non-169.254.x.x) addresses
 * Returns the first valid IP found from network interfaces
 */
export function getLocalIpAddress(): string {
  const nets = networkInterfaces();
  
  // Collect all non-internal IPv4 addresses
  const addresses: string[] = [];
  
  for (const name of Object.keys(nets)) {
    const interfaces = nets[name];
    if (!interfaces) continue;
    
    for (const net of interfaces) {
      // Skip over non-IPv4 and internal (loopback) addresses
      if (net.family === 'IPv4' && !net.internal) {
        // Skip link-local addresses (169.254.x.x)
        if (!net.address.startsWith('169.254.')) {
          addresses.push(net.address);
        }
      }
    }
  }
  
  // Return first valid address, or fallback to localhost
  return addresses[0] || '127.0.0.1';
}
