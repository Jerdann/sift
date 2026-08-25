import type {
  BrowserWindowConstructorOptions,
  HandlerDetails,
  Session,
  WebContents,
} from 'electron';

export const APP_SCHEME = 'app';
export const APP_HOST = 'mail-steward';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}/`;

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export const SECURE_WEB_PREFERENCES = Object.freeze({
  allowRunningInsecureContent: false,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  webviewTag: false,
}) satisfies Readonly<NonNullable<BrowserWindowConstructorOptions['webPreferences']>>;

const parseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

export const isTrustedRendererUrl = (
  targetUrl: string,
  developmentServerUrl?: string,
): boolean => {
  const target = parseUrl(targetUrl);
  if (!target) return false;

  if (target.protocol === `${APP_SCHEME}:` && target.host === APP_HOST) {
    return target.username === '' && target.password === '';
  }

  const developmentServer = developmentServerUrl
    ? parseUrl(developmentServerUrl)
    : null;

  return Boolean(
    developmentServer &&
      target.origin === developmentServer.origin &&
      (target.protocol === 'http:' || target.protocol === 'https:'),
  );
};

export const assertTrustedIpcSender = (
  senderUrl: string | undefined,
  developmentServerUrl?: string,
): void => {
  if (!senderUrl || !isTrustedRendererUrl(senderUrl, developmentServerUrl)) {
    throw new Error('Blocked IPC request from an untrusted renderer');
  }
};

export const denyWindowOpen = (_details: HandlerDetails) =>
  ({ action: 'deny' }) as const;

export const secureWebContents = (
  webContents: WebContents,
  developmentServerUrl?: string,
): void => {
  webContents.setWindowOpenHandler(denyWindowOpen);
  webContents.on('will-navigate', (event, targetUrl) => {
    if (!isTrustedRendererUrl(targetUrl, developmentServerUrl)) {
      event.preventDefault();
    }
  });
};

export const secureSession = (session: Session): void => {
  session.setPermissionCheckHandler(() => false);
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  session.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith(APP_ORIGIN)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
      },
    });
  });
};
