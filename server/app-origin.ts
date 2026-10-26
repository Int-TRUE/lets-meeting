// HTTP is opt-in for one exact Tailscale IPv4 origin, never a general HTTP bypass.
export function allowedHttpAppOrigin(value: string, configured?: string): boolean {
  if (!configured) return false;
  try {
    const url = new URL(value);
    const allowed = new URL(configured);
    for (const item of [url, allowed]) {
      if (
        item.protocol !== 'http:' ||
        item.pathname !== '/' ||
        item.search ||
        item.hash ||
        item.username ||
        item.password
      )
        return false;
    }
    const octets = url.hostname.split('.').map(Number);
    return (
      url.origin === allowed.origin &&
      octets.length === 4 &&
      octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
      octets[0] === 100 &&
      octets[1] >= 64 &&
      octets[1] <= 127
    );
  } catch {
    return false;
  }
}
