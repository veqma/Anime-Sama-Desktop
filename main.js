const path = require('node:path');
const { readFile, writeFile } = require('node:fs/promises');
const { app, BrowserWindow, session } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');

const appName = 'Anime-Sama Desktop';
const initialAddress = 'https://anime-sama.to/';
const appIcon = path.join(__dirname, 'app-icon.png');
const cosmeticAdStyles = `
  #sousBlocLeft,
  #sousBlocRight,
  #squBot,
  #bannBot,
  #blocBottom > p.text-sm.text-white.text-center.font-medium.opacity-50.pb-2 {
    display: none !important;
  }

  @media (min-width: 1024px) {
    #sousBlocMiddle {
      grid-column: 2 / span 6 !important;
    }
  }
`;
let adblockerReady;

function parseWebUrl(address) {
  const value = address.trim();
  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)
    ? value
    : `https://${value}`;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('Cette adresse ne semble pas valide.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Seules les adresses HTTP et HTTPS sont acceptées.');
  }

  return url.href;
}

function initializeAdblocker() {
  if (!adblockerReady) {
    const cachePath = path.join(app.getPath('userData'), 'adblocker-cache.bin');
    adblockerReady = ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: cachePath,
      read: readFile,
      write: writeFile
    })
      .then((adblocker) => adblocker.enableBlockingInSession(session.defaultSession))
      .catch((error) => {
        console.error('Impossible de charger le bloqueur de publicités.', error);
      });
  }
  return adblockerReady;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    title: appName,
    show: false,
    backgroundColor: '#101014',
    icon: appIcon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  window.removeMenu();
  window.once('ready-to-show', () => window.show());

  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('dom-ready', () => {
    if (!contents.getURL().startsWith('http')) return;
    contents.insertCSS(cosmeticAdStyles).catch((error) => {
      console.error('Impossible de masquer les éléments publicitaires.', error);
    });
  });
  contents.on('page-title-updated', (event) => event.preventDefault());
  contents.on('will-navigate', (event, address) => {
    try {
      parseWebUrl(address);
    } catch {
      event.preventDefault();
    }
  });
  contents.on('will-redirect', (event, address) => {
    try {
      parseWebUrl(address);
    } catch {
      event.preventDefault();
    }
  });
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      event.preventDefault();
      window.setFullScreen(!window.isFullScreen());
    }
    if (
      input.key === 'F12' ||
      ((input.control || input.meta) && input.shift && ['I', 'J', 'C'].includes(input.key.toUpperCase()))
    ) {
      event.preventDefault();
      contents.closeDevTools();
    }
  });
  contents.on('devtools-opened', () => contents.closeDevTools());
  window.loadFile(path.join(__dirname, 'startup-screen.html'))
    .catch((error) => {
      console.error('Impossible de charger l’écran de démarrage.', error);
    })
    .then(() => initializeAdblocker())
    .then(() => {
      if (!window.isDestroyed()) return window.loadURL(initialAddress);
    })
    .catch((error) => {
      console.error('Impossible de charger Anime-Sama.', error);
    });
}

app.whenReady().then(() => {
  app.setName(appName);
  if (process.platform === 'win32') app.setAppUserModelId('com.saam.animedesktop');
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});