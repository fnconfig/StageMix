# network_infrastructure.md

# Stage Mix Deployment Plan

## Objective
Deploy in two phases.

---

# Phase 1 (Current)

## Goal
Host the application on the Ubuntu home server.

## Architecture

Users
→ Cloudflare Tunnel
→ Ubuntu Server (Node.js)
→ Tailscale
→ Church PC (Subnet Router)
→ Church LAN
→ Yamaha TF5

## Components

### Ubuntu Home Server
- Node.js application
- PM2 or systemd
- Cloudflare Tunnel
- Tailscale

### Church Windows PC
- Tailscale
- Advertise church LAN as subnet router
- No production application required initially

### Yamaha TF5
- Existing LAN IP
- RCP TCP port 49280

## Security
- Never expose TF5 directly to the Internet.
- Cloudflare exposes only HTTP/HTTPS.
- Tailscale carries private network traffic.

## Validation
- Verify Ubuntu can reach TF5 over Tailscale.
- Test multiple simultaneous browser users.
- Confirm automatic reconnection after TF restart.

---

# Phase 2 (Future)

## Goal
Increase reliability after Phase 1 is proven.

### Planned Improvements
1. Prepare Church PC as standby host.
2. Install Node.js and PM2 on Church PC.
3. Synchronize configuration (config.json) using Syncthing, rsync, or Git workflow.
4. Implement manual failover by switching Cloudflare Tunnel to Church PC if Home server is unavailable.
5. Add health monitoring for:
   - Node.js process
   - TF5 connection
   - Tailscale connectivity
   - Disk space
   - CPU/RAM

## Out of Scope
- Active-active servers.
- Multiple concurrent RCP connections.
- Large application refactors.

## Guiding Principle
Prioritize reliability through simple, testable infrastructure. Avoid unnecessary complexity until operational experience justifies it.
