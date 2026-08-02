# AI_DEPLOYMENT.md — Stage Mix

## Phase 1 (Current)

### Network path
```
Users (any browser)
  → Cloudflare Tunnel (HTTPS, public internet)
  → Ubuntu Home Server (Node.js, PM2/systemd)
  → Tailscale (private mesh VPN)
  → Church Windows PC (Tailscale subnet router)
  → Church LAN
  → Yamaha TF5 (RCP TCP 49280)
```

### Components

**Ubuntu Home Server (acer-server)**
- Node.js 18+ running `server/index.js`
- PM2 or systemd for process management
- Cloudflare Tunnel (`cloudflared`) for public HTTPS ingress
- Tailscale for private connectivity to church LAN

**Church Windows PC**
- Tailscale installed, advertising church LAN subnet
- Runs as subnet router — no production app required
- Acts as transparent bridge to TF5

**Yamaha TF5**
- Existing LAN IP on church network
- RCP enabled (Setup → Network)
- TCP port 49280

### Security
- TF5 never exposed directly to internet
- Cloudflare exposes only HTTP/HTTPS
- Tailscale carries private TCP traffic (RCP)
- Admin password hashed with scrypt

### Validation checklist
- [ ] Ubuntu can reach TF5 over Tailscale (`nc -zv <tf-ip> 49280`)
- [ ] Multiple simultaneous browser users can control faders
- [ ] Automatic reconnection after TF restart
- [ ] Cloudflare Tunnel health checks passing

## Phase 2 (Future)

### Goal
Increase reliability after Phase 1 is proven in production.

### Planned
1. Prepare Church PC as standby host (install Node.js + PM2)
2. Synchronize `config.json` between servers (Syncthing, rsync, or Git)
3. Manual failover: switch Cloudflare Tunnel to Church PC if Home Server down
4. Health monitoring for:
   - Node.js process alive
   - TF5 RCP connection
   - Tailscale connectivity
   - Disk space
   - CPU/RAM usage

### Out of scope
- Active-active (dual-server) operation
- Multiple concurrent RCP connections
- Large application refactors
