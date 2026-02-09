package netutil

import "net"

// GetLocalIP returns the first non-loopback IPv4 address found on the host,
// mirroring the behaviour of services/worker/src/utils/network.utils.ts
// (getLocalIpAddress). If no suitable address is found it returns "127.0.0.1".
func GetLocalIP() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return "127.0.0.1"
	}
	for _, iface := range ifaces {
		// Skip down, loopback, and point-to-point interfaces.
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil || ip.IsLoopback() {
				continue
			}
			// Only return IPv4 addresses.
			if ip.To4() != nil {
				return ip.String()
			}
		}
	}
	return "127.0.0.1"
}
