# Stage Mix — band monitor-mix web app

A small self-hosted web app for your church band: each player types their name,
picks their monitor (aux) send, and drags their own faders. It talks to a
Yamaha TF-series console using **Send on Fader** over the RCP protocol
documented at https://github.com/BrenekH/yamaha-rcp-docs.

It matches the flow you sketched:

- **Normal User**: enter name → select aux channel → drag faders (send levels)
  for that mix.
- **Admin** (password protected): choose which aux mixes are available/shown,
  and remove a connection by typing someone's name.

## 1. Run it

Requires Node.js 18+.

```bash
cd monitor-mix-app
npm install
npm start
```

Open `http://localhost:3000` on the sound laptop, and `http://<that computer's LAN IP>:3000`
from band members' phones (same Wi-Fi as the laptop). No install needed on their end — it's just a web page.

It starts in **simulated mixer mode** so you can click through the whole app —
join a mix, drag faders, use the admin screens — with no console attached.
Fader moves are stored in memory and behave like a real mixer would.

## 2. Point it at your real TF console

1. On the TF console: **Setup → Network → enable RCP / external control** (this
   is the same connection Companion, QLab, etc. use), note the console's IP
   address. RCP listens on **TCP port 49280**.
2. In the app, go to **Sound desk → Mixer Link**. You'll see a live status
   readout (a dot + text showing exactly what it's connected to, or what it's
   trying to reach). Switch **Mode** to *Real TF console*, type in the
   console's IP address and port `49280`, and hit **Connect**. There's also a
   **Retry connection** button if the link drops and you just want it to try
   again without changing anything.
3. If the mixer isn't connected, **everyone** using the app — band members
   included — sees a clear red banner across the top of the screen saying the
   console is offline and that fader/mute changes won't reach it. It
   disappears automatically the moment the connection comes back. A small
   status dot in the top bar (grey/red = offline, teal = connected) is always
   visible too.

The command shapes this app uses (paths, index ranges, and the dB × 100
scale) are confirmed against the console's own self-description
(`prminfo`), captured in bitfocus/companion-module-yamaha-rcp's
`TF Parameters-1.txt` (that repo is credited as a source inside
`yamaha-rcp-docs` — its per-command pages are mostly stubs, so this was the
way to pin down exact behavior without a physical console in hand):

| Path | Index shape | Range | Notes |
|---|---|---|---|
| `InCh/Label/Name` | `<ch 0-39> 0` | string | channel name |
| `InCh/ToMix/Level` | `<ch 0-39> <mix 0-19>` | -32768..1000, dB×100 | send level (fader) |
| `InCh/ToMix/On` | `<ch 0-39> <mix 0-19>` | 0/1 | send mute (1 = unmuted) |
| `Mix/Label/Name` | `<mix 0-19>` | string | aux name — single index, no channel dimension |

A TF console only answers for as many channels/mixes as it actually has
patched (TF1=16ch, TF3=24ch, TF5=32ch; up to 20 mixes depending on config) —
requests beyond that will error, and the app treats that as "not available"
rather than crashing.

Still worth a quick check before a real rehearsal: go to **Sound desk → Raw
Console** and try `get MIXER:Current/InCh/ToMix/Level 0 0`, then move that
channel's Aux 1 send on the physical console and `get` it again, to confirm
the numbers line up with what you see on the console's own screen.

### If it won't connect

**No, RCP itself doesn't have a password** on TF consoles — the only
password-like setting that exists in the console's own parameter list is for
Yamaha's separate built-in "MonitorMix" feature (their own phone app), which
is a different thing entirely and doesn't affect this app. So if the
connection is failing, it's almost always one of these instead:

1. **RCP isn't enabled** — Setup → Network → make sure external/RCP control
   is switched on.
2. **Wrong IP or the console has multiple network ports** — TF consoles often
   have separate Dante and Network ports; RCP only works over the **NETWORK**
   port's IP, not a Dante primary/secondary address.
3. **Not on the same network** — the computer running this app and the
   console need to be reachable from each other (same subnet/VLAN, not
   separated by a router doing NAT between them).
4. **Something else is already connected** — some consoles only accept one
   RCP client at a time. If Companion, QLab, or another instance of this app
   is already connected, close it first.
5. **Windows Firewall blocking outbound** — rare, but worth checking if
   everything else looks right.

A quick way to test the network path itself, outside this app entirely, from
PowerShell on the computer running it:
```powershell
Test-NetConnection -ComputerName 192.168.1.50 -Port 49280
```
If `TcpTestSucceeded` comes back `False`, it's a network/console-setting
problem, not this app — narrows it down fast.

## 3. Set up your mixes and channels

- **Sound desk → Aux Mixes**: the console's 16 aux sends are all listed;
  flip the switch on however many you want band members to be able to pick
  from. Only visible mixes show up on the "Select Aux Channel" screen.
- **Limit which channels show up in a mix**: click **Channels** on any mix's
  row to open a checklist of every input channel — tap to include/exclude,
  use Select all/none, then **Save channels**. Handy for keeping a click
  track or talkback channel out of everyone's mix except the drummer's, for
  example. Defaults to every channel visible in every mix.
- **Pull names from console** (button on the Aux Mixes tab): fetches the real
  channel and aux names already set on the desk (`InCh/Label/Name` and
  `Mix/Label/Name`) and uses them everywhere in the app, instead of the
  generic "Channel 1" / "Aux 1" placeholders. Safe to run any time the
  console is connected — it only overwrites names the console actually
  answers for.
- **Sound desk → Channels**: rename channels by hand if you'd rather not pull
  from the console, and set how many are in use (TF5 = up to 32, TF3 = 24,
  TF1/TF-Rack = 16).

## 4. Muting

Each fader strip has a **Mute** button under it, which flips that channel's
send to the player's own mix on and off (`InCh/ToMix/On`) — it only mutes
their monitor send, not the channel itself out front.

## 5. Give band members access

Sound desk → **Share** shows the actual network address for this computer
(auto-detected, so you don't need to hunt through `ipconfig`) — copy it and
send it to the band (text, WhatsApp, whatever), or just read it out. Each
person opens that address in their phone's browser (no app install needed),
taps **"I'm on stage,"** types their name, and picks their mix.

Requirements:
- Everyone's phone needs to be on the **same Wi-Fi network** as the computer
  running this app.
- If phones can't reach it, Windows Firewall is the usual culprit — when you
  first run `npm start`, Windows may prompt "Allow Node.js to communicate on
  private networks?" → say **yes**. If you missed that prompt, open
  **Windows Defender Firewall → Allow an app through firewall** and make sure
  Node.js is allowed on **Private** networks.

## 6. Change the admin password

Default admin password is `admin123` — change it immediately from
**Sound desk → Mixer Link → Change admin password**.

## How the pieces fit together

```
public/            the phone/browser UI (no build step, plain HTML/CSS/JS)
server/index.js     Express API + WebSocket (live status/removal push)
server/rcpClient.js  real TCP client for the console (RCP protocol)
server/mockRcpClient.js  drop-in simulator, same interface, no hardware needed
server/store.js     tiny JSON-file persistence (data/config.json)
```

Band members' sessions aren't logged in — they just have a name and a browser
token stored in that phone's browser (`localStorage`). Admin sessions require
the password and a token stored only for that browser tab (`sessionStorage`),
so it clears when the tab is closed.

## Known limitations / next steps

- **Fixed:** an earlier version had a routing bug where raising the channel
  count above the default 16 (Sound desk → Channels) silently failed. That's
  now fixed — bump the count to match your console (TF5 = up to 32) *before*
  using "Pull names from console", since it only fetches names for channels
  you've told the app exist.
- **Fixed:** aux/mix names were being pulled with the wrong command shape —
  `Mix/Label/Name` needs the same two index arguments (`<mix> 0`) that
  `InCh/Label/Name` does, and the app was only sending one. If your aux names
  still don't match after updating, try the Raw Console (see below) and send
  me what comes back.
- **Fixed:** if a band member already had their fader screen open and the
  sound desk changed which channels were visible in that mix (or the channel
  count, or a channel's name), it didn't show up on their screen until they
  logged out and rejoined. It now updates live within a second or two.
- **Fixed:** loading a stage member's fader screen was doing up to 64
  sequential round-trips to the console (level + mute, one channel at a
  time) — on real hardware this could take long enough to feel frozen, and
  because everything shares one connection, it also delayed the user's own
  fader/mute commands behind that queue. It's now fetched in parallel, which
  should feel close to instant. If a channel genuinely doesn't respond
  (nothing patched at that input), the connection now cleanly reconnects
  rather than risking a later reply landing on the wrong channel.
- "Pull names from console" now warns you if you're still in **Simulated**
  mode (Sound desk → Mixer Link) — in that mode it fills in made-up
  placeholder names, not your real console's, which is easy to mistake for a
  bug. Switch to *Real TF console* mode first.
- One admin password shared by whoever runs sound — no per-user admin accounts.
- This assumes one console. If your church ever runs two consoles/rooms,
  the `mixer` config would need to become a list.
- "Pull names from console" is one-way (console → app) and only runs when you
  click the button — it doesn't continuously mirror renames made on the
  console mid-service. Re-click it any time names change.
