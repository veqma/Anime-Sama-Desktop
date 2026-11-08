const path = require('node:path');
const { readFile, writeFile } = require('node:fs/promises');
const {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  Notification,
  session,
  Tray
} = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const DiscordRPC = require('discord-rpc');

const appName = 'Anime-Sama Desktop';
const initialAddress = 'https://anime-sama.to/';
const discordAppId = '1569124306812674128';
const appIconPath = path.join(__dirname, 'app-icon.png');
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const defaultSettings = {
  discordRichPresence: false,
  launchOnStartup: false,
  adBlock: true,
  fullscreen: false,
  closeToTray: true
};
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

let settings = { ...defaultSettings };
let mainWindow;
let showWindowOnReady = false;
let tray;
let quitting = false;
let adblocker;
let adblockerReady;
let settingsQueue = Promise.resolve();
let discordClient;
let discordReady = false;
let discordRetryTimer;
let discordPresenceTimer;
let discordMediaPlaying = false;
const discordSessionStartedAt = new Date();

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

async function loadSettings() {
  try {
    const savedSettings = JSON.parse(await readFile(settingsPath(), 'utf8'));
    return Object.fromEntries(
      Object.keys(defaultSettings).map((key) => [
        key,
        typeof savedSettings[key] === 'boolean' ? savedSettings[key] : defaultSettings[key]
      ])
    );
  } catch (error) {
    if (error.code === 'ENOENT') return { ...defaultSettings };
    throw error;
  }
}

async function saveSettings() {
  await writeFile(settingsPath(), JSON.stringify(settings, null, 2));
}

function initializeAdblocker() {
  if (!adblockerReady) {
    const cachePath = path.join(app.getPath('userData'), 'adblocker-cache.bin');
    adblockerReady = ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: cachePath,
      read: readFile,
      write: writeFile
    })
      .then((blocker) => {
        adblocker = blocker;
        return blocker.enableBlockingInSession(session.defaultSession);
      })
      .catch((error) => {
        adblockerReady = undefined;
        throw error;
      });
  }
  return adblockerReady;
}

function scheduleDiscordRetry() {
  if (!settings.discordRichPresence || discordRetryTimer) return;
  discordRetryTimer = setTimeout(() => {
    discordRetryTimer = undefined;
    connectDiscordPresence();
  }, 15000);
  discordRetryTimer.unref();
}

function updateDiscordPresence() {
  if (!settings.discordRichPresence || !discordReady || !mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.webContents.getURL().startsWith('http')) return;

  const pageInfoScript = `(() => {
    const url = new URL(location.href);
    const isAnimeSama = /(^|\\.)anime-sama\\.(to|tv|si|org)$/i.test(url.hostname);
    const animeTitle = document.querySelector('#titreOeuvre')?.innerText?.trim()
      || document.querySelector('#imgOeuvre')?.alt?.trim();
    const routeType = url.pathname.match(/\\/catalogue\\/[^/]+\\/(saison[^/]*|film|oav|scan(?:_[^/]*)?)\\//i)?.[1]?.toLowerCase();
    const isScan = routeType?.startsWith('scan') === true;
    const isFilm = routeType === 'film' || routeType === 'oav';
    const episode = (isScan
      ? document.querySelector('#ctChapitreActuel')?.innerText?.trim()
        || document.querySelector('#selectChapitres')?.selectedOptions[0]?.textContent?.trim()
        || document.querySelector('#savedChapitreId')?.innerText?.trim()
      : document.querySelector('#selectEpisodes')?.selectedOptions[0]?.textContent?.trim())
      || document.querySelector('.ct-ep-actuel')?.innerText?.trim();
    const isHome = isAnimeSama && (url.pathname === '/' || url.pathname === '');
    const isWatching = isAnimeSama && Boolean(routeType && animeTitle);
    const season = !isFilm && !isScan ? url.pathname.match(/saison(\\d+)/i)?.[1] : undefined;
    const page = isScan
      ? document.querySelector('.page-indicator')?.innerText?.trim()
      : undefined;
    const image = document.querySelector('#imgOeuvre')?.src
      || (isAnimeSama ? 'https://anime-sama.to/img/opti/logo.webp' : undefined);
    return {
      title: (animeTitle || 'Anime Sama.fr').slice(0, 128),
      episode: episode?.slice(0, 128),
      page,
      season,
      image,
      isAnimeSama,
      isWatching,
      isScan,
      isFilm,
      isHome,
      isInfoPage: isAnimeSama && Boolean(animeTitle) && !isWatching && !isHome
    };
  })()`;

  mainWindow.webContents.executeJavaScript(pageInfoScript)
    .then(({ title, episode, page, season, image, isAnimeSama, isWatching, isScan, isFilm, isHome, isInfoPage }) => {
      if (!settings.discordRichPresence || !discordReady || !discordClient) return;
      if (!isAnimeSama) {
        return discordClient.clearActivity();
      }
      const details = isWatching
        ? title
        : (isInfoPage ? 'Look at the info' : 'In the home page');
      const state = isScan
        ? ['Reading manga', episode, page].filter(Boolean).join(' | ')
        : isFilm
          ? [`Watching a movie | ${discordMediaPlaying ? 'Playing' : 'Paused'}`, episode]
            .filter(Boolean).join(' | ')
          : isWatching
            ? [
            `Watch an episode | ${discordMediaPlaying ? 'Playing' : 'Paused'}`,
            [season && `Season ${season}`, episode].filter(Boolean).join(' | ')
          ].filter(Boolean).join(' · ')
            : undefined;
      return discordClient.setActivity({
        details,
        state: state?.slice(0, 128),
        largeImageKey: image,
        largeImageText: isWatching || isInfoPage ? title : appName,
        startTimestamp: discordSessionStartedAt,
        type: 3,
        instance: false
      });
    })
    .catch((error) => {
      console.error('Impossible de mettre à jour la présence Discord.', error);
    });
}

function connectDiscordPresence() {
  if (!settings.discordRichPresence || discordClient) return;

  const client = new DiscordRPC.Client({ transport: 'ipc' });
  discordClient = client;
  client.once('ready', () => {
    if (discordClient !== client || !settings.discordRichPresence) return;
    discordReady = true;
    updateDiscordPresence();
  });
  client.on('disconnected', () => {
    if (discordClient !== client) return;
    discordClient = undefined;
    discordReady = false;
    scheduleDiscordRetry();
  });
  client.on('error', (error) => {
    console.error('Erreur de connexion à Discord Rich Presence.', error);
  });
  client.login({ clientId: discordAppId }).catch((error) => {
    console.error('Discord Rich Presence est indisponible.', error);
    if (discordClient !== client) return;
    discordClient = undefined;
    discordReady = false;
    client.destroy().catch((destroyError) => {
      console.error('Impossible de fermer la connexion Discord.', destroyError);
    });
    scheduleDiscordRetry();
  });
}

function startDiscordPresence() {
  connectDiscordPresence();
  if (!discordPresenceTimer) {
    discordPresenceTimer = setInterval(updateDiscordPresence, 15000);
    discordPresenceTimer.unref();
  }
}

function stopDiscordPresence() {
  clearTimeout(discordRetryTimer);
  clearInterval(discordPresenceTimer);
  discordRetryTimer = undefined;
  discordPresenceTimer = undefined;
  discordReady = false;
  const client = discordClient;
  discordClient = undefined;
  if (client) {
    client.clearActivity()
      .catch((error) => console.error('Impossible de supprimer la présence Discord.', error))
      .finally(() => {
        client.destroy().catch((error) => {
          console.error('Impossible de fermer la connexion Discord.', error);
        });
      });
  }
}

async function updateSetting(name, value) {
  if (!Object.hasOwn(defaultSettings, name) || typeof value !== 'boolean') {
    throw new Error('Réglage invalide.');
  }
  if (name === 'launchOnStartup') {
    const args = app.isPackaged ? ['--start-in-tray'] : [app.getAppPath(), '--start-in-tray'];
    app.setLoginItemSettings({
      openAtLogin: value,
      path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
      args: value ? args : []
    });
  }
  if (name === 'adBlock') {
    if (value) {
      await initializeAdblocker();
    } else {
      adblocker?.disableBlockingInSession(session.defaultSession);
    }
  }
  if (name === 'fullscreen' && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(value);
  }
  if (name === 'discordRichPresence') {
    if (value) startDiscordPresence();
    else stopDiscordPresence();
  }
  settings[name] = value;
  await saveSettings();
  refreshTrayMenu();
  return settings;
}

function enqueueSettingUpdate(name, value) {
  const operation = settingsQueue.then(() => updateSetting(name, value));
  settingsQueue = operation.catch(() => {});
  return operation;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    showWindowOnReady = true;
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
}

function createTray() {
  const icon = nativeImage.createFromPath(appIconPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip(appName);
  refreshTrayMenu();
  tray.on('click', showMainWindow);
}

function refreshTrayMenu() {
  if (!tray) return;
  const settingItems = [
    ['discordRichPresence', 'Discord Rich Presence'],
    ['launchOnStartup', 'Launch on startup'],
    ['adBlock', 'Ad blocker'],
    ['fullscreen', 'Fullscreen'],
    ['closeToTray', 'Minimize to tray on close']
  ];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Anime-Sama Desktop', click: showMainWindow },
    { type: 'separator' },
    { label: 'Settings', enabled: false },
    ...settingItems.map(([name, label]) => ({
      label,
      type: 'checkbox',
      checked: settings[name],
      click: (item) => {
        enqueueSettingUpdate(name, item.checked).catch((error) => {
          console.error(`Could not update the ${label} setting.`, error);
          refreshTrayMenu();
          if (Notification.isSupported()) {
            new Notification({
              title: appName,
              body: `Could not update "${label}". Check the application logs.`
            }).show();
          }
        });
      }
    })),
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]));
}

function createWindow(settingsReady) {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    title: appName,
    show: false,
    backgroundColor: '#101014',
    icon: appIconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow = window;
  window.removeMenu();
  let markSplashReady;
  const splashReady = new Promise((resolve) => {
    markSplashReady = resolve;
  });
  window.once('ready-to-show', () => {
    if (process.argv.includes('--start-in-tray') && !showWindowOnReady) {
      markSplashReady();
      return;
    }
    showWindowOnReady = false;
    if (settings.fullscreen) window.setFullScreen(true);
    window.show();
    markSplashReady();
  });
  window.on('close', (event) => {
    if (quitting) return;
    if (!settings.closeToTray) {
      quitting = true;
      return;
    }
    event.preventDefault();
    window.hide();
    if (Notification.isSupported()) {
      new Notification({
        title: appName,
        body: 'Anime-Sama a été réduite dans la zone de notification.'
      }).show();
    }
  });
  window.on('enter-full-screen', () => {
    settings.fullscreen = true;
    saveSettings().then(refreshTrayMenu).catch((error) => {
      console.error('Impossible de sauvegarder les réglages.', error);
    });
  });
  window.on('leave-full-screen', () => {
    settings.fullscreen = false;
    saveSettings().then(refreshTrayMenu).catch((error) => {
      console.error('Impossible de sauvegarder les réglages.', error);
    });
  });

  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('dom-ready', () => {
    if (!contents.getURL().startsWith('http')) return;
    contents.insertCSS(cosmeticAdStyles).catch((error) => {
      console.error('Impossible de masquer les éléments publicitaires.', error);
    });
  });
  contents.on('page-title-updated', (event) => {
    event.preventDefault();
    window.setTitle(appName);
    updateDiscordPresence();
  });
  contents.on('did-navigate', () => {
    discordMediaPlaying = false;
    updateDiscordPresence();
  });
  contents.on('did-navigate-in-page', () => {
    discordMediaPlaying = false;
    updateDiscordPresence();
  });
  contents.on('media-started-playing', () => {
    discordMediaPlaying = true;
    updateDiscordPresence();
  });
  contents.on('media-paused', () => {
    discordMediaPlaying = false;
    updateDiscordPresence();
  });
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
    .then(async () => {
      await splashReady;
      await settingsReady;
      if (settings.fullscreen && !window.isFullScreen()) window.setFullScreen(true);
      if (settings.adBlock) {
        try {
          await initializeAdblocker();
        } catch (error) {
          console.error('Impossible de charger le bloqueur de publicités.', error);
        }
      }
      if (!window.isDestroyed()) return window.loadURL(initialAddress);
    })
    .catch((error) => {
      console.error('Impossible de charger Anime-Sama.', error);
    });
}

app.on('before-quit', () => {
  quitting = true;
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  app.setName(appName);
  if (process.platform === 'win32') app.setAppUserModelId('com.saam.animedesktop');
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'fullscreen');
  });
  const settingsReady = loadSettings().then((loadedSettings) => {
    settings = loadedSettings;
    createTray();
    if (settings.discordRichPresence) startDiscordPresence();
  });
  createWindow(settingsReady);
  app.on('activate', showMainWindow);
  await settingsReady;
}).catch((error) => {
  console.error('Impossible de démarrer Anime-Sama Desktop.', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
