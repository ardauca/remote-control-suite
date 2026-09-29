# iPhone → Windows Remote Control Suite

Production-quality, ultra-low latency, zero-cloud PC remote control platform for iPhone (Safari / PWA) and Windows.

---

## Architecture Overview

* **Host (Windows):** Built on **C# / .NET 9** using ASP.NET Core Kestrel for high-throughput HTTP & WebSocket communication, and a lightweight Windows Forms **System Tray (NotifyIcon)** background process.
* **Client (iPhone):** Built on **React 19 + TypeScript + Vite + Tailwind CSS + Zustand** packaged as an installable **Progressive Web App (PWA)** optimized specifically for iOS Safari, notches, safe area insets, and gesture isolation.

---

## Phase 1 Acceptance Verification

### 1. Windows Firewall Ayarları (Firewall Configuration)
Windows Agent yerel ağdaki (LAN) iPhone'unuzdan gelen istekleri dinlediği için, Windows Güvenlik Duvarı'nda sadece Özel (Private) ağ profili için 52520 portuna izin verilmesi yeterlidir:

**PowerShell (Yönetici olarak çalıştırın):**
```powershell
New-NetFirewallRule -DisplayName "Remote Control Suite Agent" -Direction Inbound -LocalPort 52520 -Protocol TCP -Action Allow -Profile Private
```
*(Not: Portu asla Public/İnternete açmayın, sadece Private/Ev ağında çalıştırın.)*

---

## Çalıştırma Adımları (How to Run)

### 1. Web İstemcisini Derleme (Build Client)
İstemciyi bir kez derleyerek Windows Agent'ın `wwwroot` dizinine gömün:
```bash
cd client
npm run build
```

### 2. Windows Agent'ı Başlatma (Start Agent)
```bash
cd server/RemoteAgent
dotnet run
```
Açıldığında:
* Windows System Tray'de (saat yanında) uygulamanın ikonu görünür.
* İkona sağ tıklayarak **"View Local Network IPs"** seçeneğinden bilgisayarınızın yerel IP adresini görebilirsiniz (Örn: `http://192.168.1.65:52520`).
* Kapatmak için tray menüsünden **"Exit Remote Suite"** seçebilirsiniz.

### 3. iPhone Safari'den Bağlanma (Connect from iPhone)
1. iPhone'unuzun bilgisayarla **aynı Wi-Fi ağına** bağlı olduğundan emin olun.
2. Safari'yi açın ve bilgisayarın yerel adresine gidin:
   `http://<PC_IP_ADRESI>:52520` (Örn: `http://192.168.1.65:52520`).
3. Web uygulaması açıldığında otomatik olarak WebSocket bağlantısı kurar (`ws://.../ws`).
4. Ekranda yeşil renkli **"Connected"** rozeti ve gerçek zamanlı **Ping / Latency (ms)** değeri görüntülenir.
5. İsterseniz Safari paylaşım menüsünden **"Ana Ekrana Ekle" (Add to Home Screen)** yaparak tam ekran bir yerel uygulama gibi kullanabilirsiniz.

---

## Otomatik Testler (Automated Acceptance Tests)
Windows Agent çalışırken aşağıdaki testleri çalıştırabilirsiniz:
```bash
# HTTP ve PWA statik dosya testi:
node scripts/verify-phase1.js

# WebSocket bağlantı, system.hello ve heartbeat (system.ping -> system.pong) testi:
node scripts/verify-websocket.js
```
