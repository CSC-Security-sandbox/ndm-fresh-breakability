import { networkInterfaces } from 'os';

const IPV4_FAMILY = 'IPv4';
const FALLBACK_IP = '127.0.0.1';

/**
 * Detects the local IP address of the worker machine.
 * 
 * Returns the first non-loopback IPv4 address found. Whatever IP the worker has
 * is its actual address on the network - no filtering or prioritization needed.
 * 
 * @returns The first non-loopback IPv4 address found, or '127.0.0.1' if none available
 */
export function getLocalIpAddress(): string {
  const nets = networkInterfaces();

  for (const name of Object.keys(nets)) {
    const interfaces = nets[name];
    if (!interfaces) continue;

    for (const net of interfaces) {
      // Return first IPv4 address that's not loopback
      if (net.family === IPV4_FAMILY && !net.internal) {
        return net.address;
      }
    }
  }

  return FALLBACK_IP;
}
