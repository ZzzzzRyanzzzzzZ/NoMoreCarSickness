const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, globalShortcut, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const selfsigned = require('selfsigned');
const QRCode = require('qrcode');
const ws = require('./ws');

const PORT = Number(process.env.MOTION_CUES_PORT) || 8443;

const DEFAULTS = {
  enabled: true,
  size: 14,
  color: '#4da3ff',
  opacity: 0.85,
  contrast: 40,
  layout: 'edges',
  rows: 9,
  columns: 2,
  inset: 28,
  sensitivity: 30,
  responsiveness: 50,
  fadeWhenStill: true,
  invertX: false,
  invertY: false,
  demo: false,
};

if (!app.requestSingleInstanceLock()) app.quit();

let settings;
let overlay, settingsWin, tray;
let quitting = false;
const phones = new Set();

const dataFile = name => path.join(app.getPath('userData'), name);

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(dataFile('settings.json'), 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}

let saveTimer;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(dataFile('settings.json'), JSON.stringify(settings, null, 2), () => {}), 300);
}

function sendTo(win, channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function updateSettings(patch) {
  settings = { ...settings, ...patch };
  saveSettings();
  sendTo(overlay, 'settings', settings);
  sendTo(settingsWin, 'settings', settings);
  applyOverlayVisibility();
  refreshTray();
}

// --- Phone connection -------------------------------------------------------

function lanAddresses() {
  const virtual = /vethernet|virtual|vmware|vbox|hyper-v|wsl|docker|loopback|bluetooth/i;
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
  }
  return out.sort((a, b) => virtual.test(a.name) - virtual.test(b.name));
}

// iOS needs HTTPS before Safari will hand over motion data, so we make a
// self-signed certificate once and keep it (Safari remembers the exception).
// Apple rejects server certs valid longer than 825 days, so keep it to ~1 year.
function loadCert() {
  const keyPath = dataFile('key.pem'), certPath = dataFile('cert.pem');
  try {
    if (Date.now() - fs.statSync(certPath).mtimeMs < 390 * 864e5) {
      return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
    }
  } catch {}
  const pems = selfsigned.generate([{ name: 'commonName', value: 'Motion Cues' }], {
    days: 397,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, ...lanAddresses().map(a => ({ type: 7, ip: a.address }))] },
    ],
  });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

function startServer() {
  const server = https.createServer(loadCert(), (req, res) => {
    if (req.url.split('?')[0] === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      fs.createReadStream(path.join(__dirname, 'phone.html')).pipe(res);
    } else {
      res.writeHead(404).end();
    }
  });

  ws.attach(server, '/ws', conn => {
    phones.add(conn);
    sendStatus();
    conn.on('message', text => {
      let m;
      try { m = JSON.parse(text); } catch { return; }
      if (m.t !== 'm' || !Number.isFinite(m.f) || !Number.isFinite(m.r)) return;
      const motion = { f: m.f, r: m.r };
      sendTo(overlay, 'motion', motion);
      sendTo(settingsWin, 'motion', motion);
    });
    conn.on('close', () => { phones.delete(conn); sendStatus(); });
  });

  server.on('error', err => {
    dialog.showErrorBox('Motion Cues', err.code === 'EADDRINUSE'
      ? `Port ${PORT} is already in use. Close the other copy, or set MOTION_CUES_PORT to another port.`
      : String(err));
  });
  server.listen(PORT, '0.0.0.0');
}

function sendStatus() {
  sendTo(settingsWin, 'status', { phones: phones.size });
  refreshTray();
}

async function connectInfo() {
  const urls = lanAddresses().map(a => ({ name: a.name, url: `https://${a.address}:${PORT}/` }));
  const qr = urls.length ? await QRCode.toDataURL(urls[0].url, { margin: 1, width: 220 }) : null;
  return { urls, qr, phones: phones.size };
}

// --- Windows ----------------------------------------------------------------

const preload = path.join(__dirname, 'preload.js');

function createOverlay() {
  const { bounds } = screen.getPrimaryDisplay();
  overlay = new BrowserWindow({
    ...bounds,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: { preload, backgroundThrottling: false },
  });
  overlay.setIgnoreMouseEvents(true);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.loadFile('overlay.html');
  overlay.once('ready-to-show', applyOverlayVisibility);

  const fit = () => overlay.setBounds(screen.getPrimaryDisplay().bounds);
  screen.on('display-metrics-changed', fit);
  screen.on('display-added', fit);
  screen.on('display-removed', fit);
}

function applyOverlayVisibility() {
  if (!overlay || overlay.isDestroyed()) return;
  if (settings.enabled) {
    overlay.showInactive();
    overlay.setAlwaysOnTop(true, 'screen-saver');
  } else {
    overlay.hide();
  }
}

function showSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 480,
    height: 860,
    minWidth: 380,
    title: 'Motion Cues',
    autoHideMenuBar: true,
    backgroundColor: '#14161a',
    webPreferences: { preload },
  });
  settingsWin.loadFile('settings.html');
  settingsWin.on('close', e => {
    if (!quitting) { e.preventDefault(); settingsWin.hide(); }
  });
}

// --- Tray -------------------------------------------------------------------

function trayIcon() {
  const size = 16, px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5), i = (y * size + x) * 4;
    const a = Math.max(0, Math.min(1, 7 - d));
    px[i] = 255; px[i + 1] = 163; px[i + 2] = 77; px[i + 3] = Math.round(a * 255); // BGRA
  }
  return nativeImage.createFromBitmap(px, { width: size, height: size });
}

function refreshTray() {
  if (!tray) return;
  tray.setToolTip(`Motion Cues — ${phones.size ? 'phone connected' : 'waiting for phone'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: phones.size ? 'Phone connected' : 'Waiting for phone…', enabled: false },
    { type: 'separator' },
    { label: 'Settings…', click: showSettings },
    { label: 'Show dots  (Ctrl+Alt+M)', type: 'checkbox', checked: settings.enabled, click: i => updateSettings({ enabled: i.checked }) },
    { label: 'Demo motion', type: 'checkbox', checked: settings.demo, click: i => updateSettings({ demo: i.checked }) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

// --- App --------------------------------------------------------------------

ipcMain.handle('settings:get', () => settings);
ipcMain.handle('connect:info', connectInfo);
ipcMain.on('settings:set', (_e, patch) => updateSettings(patch));
ipcMain.on('settings:reset', () => updateSettings({ ...DEFAULTS }));

app.on('second-instance', showSettings);
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {}); // live in the tray

app.whenReady().then(() => {
  settings = loadSettings();
  startServer();
  createOverlay();
  showSettings();
  tray = new Tray(trayIcon());
  tray.on('click', showSettings);
  refreshTray();
  globalShortcut.register('Control+Alt+M', () => updateSettings({ enabled: !settings.enabled }));
});
