import { BlockList, isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

declare module 'fastify' { interface FastifyRequest { clientIp: string; countedRequest: boolean } }
export interface SecurityOptions {
  proxyMode?: 'direct' | 'fly'; trustedProxyCidrs?: string[]; flyIpv4Listener?: boolean;
  requestsPerMinute?: number; globalRequestsPerMinute?: number; maxConcurrent?: number;
}
export function securityFromEnvironment(): SecurityOptions {
  const mode = process.env.CLIENT_IP_MODE ?? (process.env.FLY_APP_NAME ? 'fly' : 'direct');
  if (mode !== 'direct' && mode !== 'fly') throw new Error('CLIENT_IP_MODE must be direct or fly');
  return { proxyMode: mode, flyIpv4Listener: mode === 'fly' && Boolean(process.env.FLY_APP_NAME), trustedProxyCidrs: (process.env.TRUSTED_PROXY_CIDRS ?? '').split(',').filter(Boolean) };
}
export function clientIpResolver(options: SecurityOptions) {
  const trusted = new BlockList();
  const cidrs = options.trustedProxyCidrs ?? [];
  if (options.proxyMode === 'fly' && !cidrs.length && !options.flyIpv4Listener) throw new Error('Fly client-IP mode requires TRUSTED_PROXY_CIDRS');
  for (const cidr of cidrs) {
    const [address, prefix, extra] = cidr.trim().split('/');
    const family = isIP(address);
    if (!family || extra || !/^\d+$/.test(prefix ?? '') || Number(prefix) > (family === 4 ? 32 : 128)) throw new Error('Invalid trusted-proxy CIDR');
    trusted.addSubnet(address, Number(prefix), family === 4 ? 'ipv4' : 'ipv6');
  }
  return (request: FastifyRequest): string | undefined => {
    const peer = request.raw.socket.remoteAddress ?? '';
    if (options.proxyMode !== 'fly') return peer;
    const family = isIP(peer);
    // Fly Proxy connects over IPv4. Our 0.0.0.0 listener excludes direct IPv6 6PN traffic.
    const validPeer = cidrs.length ? trusted.check(peer, family === 4 ? 'ipv4' : 'ipv6') : options.flyIpv4Listener && family === 4;
    if (!family || !validPeer) return undefined;
    const value = request.headers['fly-client-ip'];
    // Ignore all X-Forwarded-* and CF-* values. Fly replaces this header at its edge.
    if (typeof value !== 'string' || !isIP(value)) return undefined;
    return value;
  };
}

/** Bounded process-local admission limits protect SQLite and include public reads/assets. */
export class TrafficLimiter {
  private buckets = new Map<string, { count: number; reset: number }>();
  private global = { count: 0, reset: 0 };
  constructor(private options: SecurityOptions) {}
  allow(ip: string, now = Date.now()) {
    if (this.global.reset <= now) this.global = { count: 0, reset: now + 60_000 };
    if (this.global.count >= (this.options.globalRequestsPerMinute ?? 3000)) return false;
    this.global.count++;
    for (const [key, bucket] of this.buckets) if (bucket.reset <= now) this.buckets.delete(key);
    let bucket = this.buckets.get(ip);
    if (!bucket) {
      if (this.buckets.size >= 10000) return false;
      bucket = { count: 0, reset: now + 60_000 }; this.buckets.set(ip, bucket);
    }
    return ++bucket.count <= (this.options.requestsPerMinute ?? 300);
  }
}
