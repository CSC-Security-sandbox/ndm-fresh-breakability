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
 * Appends the AD server IP to the Windows Ethernet adapter DNS list if not already present.
 *
 * Design decisions:
 * - We do NOT reorder or delete existing DNS entries. The VM may have a Group Policy or a
 *   preconfigured corporate DNS order that must be preserved. Reordering would be destructive.
 * - We only add the IP when it is absent entirely, using index=1 so it sits at the top of
 *   the list on first insertion. If it is already present at any position, it means the adapter
 *   is already configured (either by us or by the admin) and we leave it untouched.
 * - `netsh` commands are local registry writes (~50ms each) — no network call, no service restart.
 * - If `netsh` fails (e.g. Group Policy locks DNS changes), we warn and continue. The operation
 *   is best-effort: if the admin has locked DNS, they have presumably configured the correct
 *   servers already.
 * - No-op on non-Windows platforms.
 */
export async function configureSmbAdDns(traceId: string, dnsServerIp: string, logger: { log: Function; warn: Function }): Promise<void> {
  if (process.platform !== 'win32') return;

  try {
    const { stdout } = await execAsync(`netsh interface ip show dns name="Ethernet"`);

    if (stdout.includes(dnsServerIp)) {
      logger.log(`[${traceId}] AD DNS ${dnsServerIp} already present in adapter DNS list, skipping`);
      return;
    }

    // Not present — add at index=1 so it is the first entry queried on this adapter.
    // Existing entries shift down; nothing is removed.
    await execAsync(`netsh interface ip add dns name="Ethernet" addr=${dnsServerIp} index=1 validate=no`);
    logger.log(`[${traceId}] AD DNS ${dnsServerIp} added at index=1 in adapter DNS list`);
  } catch (error) {
    // Warn only — do not throw. If Group Policy prevents DNS changes the VM admin has
    // presumably already configured the correct DNS, so we should not block the operation.
    logger.warn(`[${traceId}] Failed to configure AD DNS ${dnsServerIp}: ${error.message}`);
  }
}
