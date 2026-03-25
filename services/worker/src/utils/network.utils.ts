import { networkInterfaces } from 'os';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

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

/**
 * Configures the AD server IP as the primary DNS entry on the Windows Ethernet adapter.
 * Inserts at index=1 so it is queried first, preserving all existing DNS entries (shifted down).
 * Idempotent — skips if the IP is already present in the adapter's DNS list.
 * No-op on non-Windows platforms.
 */
export async function configureSmbAdDns(traceId: string, dnsServerIp: string, logger: { log: Function; warn: Function }): Promise<void> {
  if (process.platform !== 'win32') return;

  try {
    const { stdout } = await execAsync(`netsh interface ip show dns name="Ethernet"`);
    if (stdout.includes(dnsServerIp)) {
      logger.log(`[${traceId}] AD DNS ${dnsServerIp} already configured, skipping`);
      return;
    }
    await execAsync(`netsh interface ip add dns name="Ethernet" addr=${dnsServerIp} index=1 validate=no`);
    logger.log(`[${traceId}] AD DNS ${dnsServerIp} inserted at index=1 in adapter DNS list`);
  } catch (error) {
    logger.warn(`[${traceId}] Failed to configure AD DNS ${dnsServerIp}: ${error.message}`);
  }
}
