import { networkInterfaces } from 'os';
import { promisify } from 'util';
import { exec } from 'child_process';
import * as dns from 'dns';

const execAsync = promisify(exec);

const IPV4_FAMILY = 'IPv4';
const FALLBACK_IP = '127.0.0.1';

/**
 * Detects the local IP address of the worker machine.
 *
 * Returns the first non-loopback IPv4 address found.
 *
 * @returns The first non-loopback IPv4 address found, or '127.0.0.1' if none available
 */
export function getLocalIpAddress(): string {
  const nets = networkInterfaces();

  for (const name of Object.keys(nets)) {
    const interfaces = nets[name];
    if (!interfaces) continue;

    for (const net of interfaces) {
      if (net.family === IPV4_FAMILY && !net.internal) {
        return net.address;
      }
    }
  }

  return FALLBACK_IP;
}

/**
 * Reads all DNS server IPs currently configured on the Windows Ethernet adapter.
 *
 * Parses the output of `netsh interface ip show dns name="Ethernet"` and extracts
 * every IPv4 address from the output lines.
 *
 * Returns an empty array if the command fails or the output contains no IPs.
 */
async function getAdapterDnsEntries(logger: { warn: (msg: string) => void }): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`netsh interface ip show dns name="Ethernet"`);
    const entries: string[] = [];
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      // Each DNS line contains the IP as a standalone token — extract it
      const match = trimmed.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
      if (match) entries.push(match[1]);
    }
    return entries;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to read adapter DNS entries: ${msg}`);
    return [];
  }
}

/**
 * Resolves an SMB file server hostname to an IP address using the Windows DNS adapter list.
 *
 * Strategy (in order):
 *   1. If hostname is already an IP — return it directly, no DNS needed.
 *   2. If adServerIp is provided — add it to the Windows Ethernet adapter DNS list via
 *      netsh (best-effort, additive only — does not remove or reorder existing entries).
 *   3. Read ALL DNS entries currently on the adapter (includes the newly added one plus
 *      any pre-existing corporate/domain DNS servers).
 *   4. Iterate over every entry via Node.js dns.Resolver, querying each one independently.
 *      The first server that returns a result wins. Servers that return NXDOMAIN or are
 *      unreachable are skipped and the next one is tried.
 *   5. Fall back to system DNS (dns.promises.lookup) if every adapter entry fails.
 *   6. If all resolution fails — return the original hostname so the OS can attempt it
 *      at command execution time.
 *
 * Why iterate over the whole adapter list rather than only the adServerIp:
 *   The Windows VM may already have corporate DNS servers pre-configured. In a multi-domain
 *   or failover scenario, one of those pre-existing servers may be able to resolve the
 *   hostname even when the AD server itself returns NXDOMAIN. Iterating over all entries
 *   gives the best possible chance of successful resolution without being brittle about
 *   which server knows about which domain.
 *
 * No-op on non-Windows — returns hostname unchanged (Linux/macOS workers use mount-tracker).
 */
export async function resolveHostnameForSmb(
  traceId: string,
  hostname: string,
  adServerIp: string | undefined,
  logger: { log: (msg: string) => void; warn: (msg: string) => void },
): Promise<string> {
  if (process.platform !== 'win32') return hostname;

  const trimmed = hostname.trim();

  // Already an IP — nothing to resolve
  if (dns.isIP(trimmed)) {
    logger.log(`[${traceId}] SMB host ${trimmed} is already an IP, skipping DNS resolution`);
    return trimmed;
  }

  // Step 1: register the AD server IP in the adapter DNS list (best-effort)
  if (adServerIp) {
    try {
      const { stdout } = await execAsync(`netsh interface ip show dns name="Ethernet"`);
      if (!stdout.includes(adServerIp)) {
        await execAsync(`netsh interface ip add dns name="Ethernet" addr=${adServerIp} validate=no`);
        logger.log(`[${traceId}] Added AD DNS ${adServerIp} to Ethernet adapter`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[${traceId}] Could not add AD DNS ${adServerIp} to adapter (Group Policy may prevent it): ${msg}`);
    }
  }

  // Step 2: read all DNS entries on the adapter and iterate over each one
  const adapterEntries = await getAdapterDnsEntries(logger);

  if (adapterEntries.length > 0) {
    for (const dnsIp of adapterEntries) {
      try {
        const resolver = new dns.Resolver();
        resolver.setServers([dnsIp]);
        const addresses = await new Promise<string[]>((resolve, reject) => {
          resolver.resolve4(trimmed, (err, addrs) => (err ? reject(err) : resolve(addrs ?? [])));
        });
        if (addresses.length > 0) {
          logger.log(`[${traceId}] Resolved ${trimmed} → ${addresses[0]} via adapter DNS ${dnsIp}`);
          return addresses[0];
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[${traceId}] Adapter DNS ${dnsIp} failed to resolve ${trimmed}: ${msg}, trying next`);
      }
    }
  }

  // Step 3: system DNS fallback after all adapter entries exhausted
  try {
    const { address } = await dns.promises.lookup(trimmed, { family: 4 });
    logger.log(`[${traceId}] Resolved ${trimmed} → ${address} via system DNS`);
    return address;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[${traceId}] System DNS also failed to resolve ${trimmed}: ${msg}, using original hostname`);
  }

  // Step 4: last resort — let the OS try at command execution time
  return trimmed;
}
