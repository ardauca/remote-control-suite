# Remote Suite for Windows

Remote Suite runs its host on your Windows PC. Your iPhone connects directly to that PC over your home network; no shared Remote Suite account or cloud server is required.

## Install the Windows host

1. Download and extract `RemoteSuite-win-x64.zip` to a permanent folder, for example `%LOCALAPPDATA%\Programs\RemoteSuite`.
2. Run `RemoteAgent.exe` and allow it through Windows Firewall on **Private networks** when prompted.
3. Keep the agent running in the notification area. You can enable **Start with Windows** in the dashboard.

The PC must be powered on and a Windows user must be signed in for desktop control, screen capture, audio, and media features.

## Connect an iPhone

1. Connect the iPhone to the same private Wi-Fi network as the PC. Do not use a guest Wi-Fi network that isolates devices.
2. Read the PC address from the Remote Suite dashboard, then open `http://<PC-IP>:52520` in Safari.
3. Enter the six-digit pairing PIN shown on the PC.
4. Optionally choose **Share → Add to Home Screen** in Safari.

Each iPhone pairs separately with each PC. Pairing is stored locally on that PC and its token stays in the iPhone browser storage for that PC's address.

## Network and security

- The host listens on TCP port `52520`. Allow inbound access only on the Windows **Private** network profile.
- Both devices need to be on the same home network for the standard setup. Do not expose port `52520` directly to the public internet with router port forwarding.
- For different networks, use a private VPN between the iPhone and PC; the Remote Suite app does not provide a cloud relay.
- Windows UAC secure-desktop prompts and locked screens restrict synthetic mouse/keyboard input by design.

## Troubleshooting

- Confirm the PC and iPhone are on the same Wi-Fi and the network is marked **Private** in Windows.
- In Safari, open the exact IP and port shown by the PC dashboard.
- If the PC address changes, update the address in Safari or reserve the PC's IP in the router.
- If pairing fails, read the current PIN from the dashboard; PINs expire after 24 hours.
