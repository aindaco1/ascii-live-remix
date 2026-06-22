import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const configPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const notarizedConfigPath = path.join(root, 'src-tauri', 'tauri.notarized.conf.json');
const capabilitiesDir = path.join(root, 'src-tauri', 'capabilities');
const infoPlistPath = path.join(root, 'src-tauri', 'Info.plist');
const entitlementsPath = path.join(root, 'src-tauri', 'Entitlements.plist');
const releaseWorkflowPath = path.join(root, '.github', 'workflows', 'release-desktop.yml');
const tauriRoot = path.join(root, 'src-tauri');
const issues = [];

const allowedRemoteDevPrefixes = [
  'http://127.0.0.1',
  'ws://127.0.0.1',
  'http://localhost',
  'ws://localhost',
  'http://asset.localhost',
  'https://asset.localhost',
  'http://ipc.localhost'
];

function matchesRemoteUrl(value) {
  return String(value || '').match(/https?:\/\/[^\s"'<>]+|wss?:\/\/[^\s"'<>]+/gi) || [];
}

function isAllowedPolicyUrl(url) {
  return allowedRemoteDevPrefixes.some((prefix) => url.startsWith(prefix));
}

function checkNoOnlineUrls(label, value) {
  for (const url of matchesRemoteUrl(value)) {
    if (isAllowedPolicyUrl(url)) continue;
    issues.push(`${label} contains online URL ${url}`);
  }
}

const config = JSON.parse(await readFile(configPath, 'utf8'));
const notarizedConfig = JSON.parse(await readFile(notarizedConfigPath, 'utf8'));
const security = config?.app?.security || {};
const updaterEndpoint = 'https://github.com/aindaco1/ascii-live-remix/releases/latest/download/latest.json';

if (!security.csp || typeof security.csp !== 'string') {
  issues.push('app.security.csp must be a non-empty production CSP string');
} else {
  checkNoOnlineUrls('app.security.csp', security.csp);
  if (!security.csp.includes("object-src 'none'")) issues.push("production CSP must include object-src 'none'");
  if (!security.csp.includes("frame-ancestors 'none'")) issues.push("production CSP must include frame-ancestors 'none'");
  if (security.csp.includes("'unsafe-eval'")) issues.push("production CSP must not include 'unsafe-eval'");
}

if (!security.devCsp || typeof security.devCsp !== 'string') {
  issues.push('app.security.devCsp must be a non-empty development CSP string');
} else {
  checkNoOnlineUrls('app.security.devCsp', security.devCsp);
}

if (security.freezePrototype !== true) {
  issues.push('app.security.freezePrototype must be true');
}

if (config?.app?.macOSPrivateApi !== true) {
  issues.push('app.macOSPrivateApi must be true so the macOS webview uses the required private API preferences');
}

if (config?.bundle?.macOS?.entitlements !== 'Entitlements.plist') {
  issues.push('bundle.macOS.entitlements must point to Entitlements.plist for camera and microphone capture');
}

let entitlements = '';
try {
  entitlements = await readFile(entitlementsPath, 'utf8');
} catch {
  issues.push('src-tauri/Entitlements.plist is required for macOS camera and microphone capture');
}
for (const key of [
  'com.apple.security.device.audio-input',
  'com.apple.security.device.camera',
  'com.apple.security.device.microphone'
]) {
  if (!entitlements.includes(`<key>${key}</key>`)) {
    issues.push(`Entitlements.plist must include ${key}`);
  }
}

const mainWindow = Array.isArray(config?.app?.windows)
  ? config.app.windows.find((windowConfig) => windowConfig?.label === 'main') || config.app.windows[0]
  : null;
if (mainWindow?.useHttpsScheme !== true) {
  issues.push('app.windows[main].useHttpsScheme must be true so browser media capture runs on a secure local origin');
}

if (security.assetProtocol?.enable !== true) {
  issues.push('app.security.assetProtocol.enable must be true');
}

if (!Array.isArray(security.assetProtocol?.scope) || security.assetProtocol.scope.length !== 0) {
  issues.push('app.security.assetProtocol.scope must remain empty; selected files are allowed session-locally by Rust');
}

const resources = config?.bundle?.resources || [];
if (!Array.isArray(resources) || !resources.includes('resources/ffmpeg/**/*')) {
  issues.push('bundle.resources must include resources/ffmpeg/**/* for packaged FFmpeg sidecars');
}
if (!Array.isArray(resources) || !resources.includes('../media/**/*')) {
  issues.push('bundle.resources must include ../media/**/* for packaged native output demo media');
}

const requiredIcons = [
  'icons/32x32.png',
  'icons/128x128.png',
  'icons/128x128@2x.png',
  'icons/icon.icns',
  'icons/icon.ico'
];
const icons = config?.bundle?.icon || [];
for (const icon of requiredIcons) {
  if (!Array.isArray(icons) || !icons.includes(icon)) {
    issues.push(`bundle.icon must include ${icon}`);
    continue;
  }
  try {
    await access(path.join(tauriRoot, icon));
  } catch {
    issues.push(`configured icon file is missing: ${icon}`);
  }
}

if (config?.bundle?.macOS?.infoPlist !== 'Info.plist') {
  issues.push('bundle.macOS.infoPlist must point to Info.plist');
}

if (config?.bundle?.macOS?.signingIdentity !== '-') {
  issues.push('bundle.macOS.signingIdentity must be "-" for default ad-hoc self-signing');
}

if (notarizedConfig?.bundle?.macOS?.infoPlist !== 'Info.plist') {
  issues.push('tauri.notarized.conf.json must preserve bundle.macOS.infoPlist');
}

if (notarizedConfig?.bundle?.macOS?.signingIdentity !== null) {
  issues.push('tauri.notarized.conf.json must set bundle.macOS.signingIdentity to null so CI can infer Developer ID identity');
}

if (notarizedConfig?.bundle?.macOS?.hardenedRuntime !== true) {
  issues.push('tauri.notarized.conf.json must enable bundle.macOS.hardenedRuntime for notarization');
}

if (config?.bundle?.createUpdaterArtifacts !== true) {
  issues.push('bundle.createUpdaterArtifacts must be true so release builds generate signed updater packages');
}

const updater = config?.plugins?.updater || {};
if (!updater.pubkey || typeof updater.pubkey !== 'string') {
  issues.push('plugins.updater.pubkey must contain the public updater signing key');
}
const updaterEndpoints = updater.endpoints || [];
if (!Array.isArray(updaterEndpoints) || updaterEndpoints.length !== 1 || updaterEndpoints[0] !== updaterEndpoint) {
  issues.push(`plugins.updater.endpoints must be exactly ${updaterEndpoint}`);
}

async function readCapabilities() {
  const out = new Map();
  const entries = await readdir(capabilitiesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(capabilitiesDir, entry.name);
    out.set(entry.name, JSON.parse(await readFile(filePath, 'utf8')));
  }
  return out;
}

const capabilities = await readCapabilities();
for (const [name, capability] of capabilities) {
  if ('remote' in capability || 'urls' in capability) {
    issues.push(`${name} must not grant remote origins access to Tauri commands`);
  }
  checkNoOnlineUrls(name, JSON.stringify(capability));
}

const mainCapability = capabilities.get('default.json');
const outputCapability = capabilities.get('output.json');
if (!mainCapability) {
  issues.push('default.json capability is required for the main window');
} else {
  const windows = mainCapability.windows || [];
  if (windows.length !== 1 || windows[0] !== 'main') {
    issues.push('default.json capability must apply only to the main window');
  }
  const permissions = new Set(mainCapability.permissions || []);
  const requiredMainPermissions = [
    'dialog:allow-open',
    'core:webview:allow-clear-all-browsing-data',
    'core:webview:allow-create-webview-window',
    'process:allow-restart',
    'allow-select-media-file',
    'allow-list-media-files',
    'allow-forget-media-file',
    'allow-probe-registered-media',
    'allow-preview-registered-media',
    'allow-start-registered-media-session',
    'allow-read-media-session-frame',
    'allow-read-media-session-frames',
    'allow-stop-media-session',
    'allow-list-media-sessions',
    'allow-request-media-permission',
    'allow-record-media-diagnostic',
    'allow-open-native-output-window',
    'allow-update-native-output-window',
    'allow-update-native-output-frame',
    'allow-update-native-output-pixels',
    'allow-start-system-audio-capture',
    'allow-read-system-audio-features',
    'allow-stop-system-audio-capture'
  ];
  for (const permission of requiredMainPermissions) {
    if (!permissions.has(permission)) {
      issues.push(`main capability must include ${permission}`);
    }
  }
  if (!permissions.has('updater:default')) {
    issues.push('main capability must include updater:default');
  }
}

if (!outputCapability) {
  issues.push('output.json capability is required for the output window');
} else {
  const windows = outputCapability.windows || [];
  if (windows.length !== 1 || windows[0] !== 'output') {
    issues.push('output.json capability must apply only to the output window');
  }
  const permissions = new Set(outputCapability.permissions || []);
  const requiredOutputPermissions = [
    'core:event:allow-listen',
    'core:window:allow-close',
    'core:window:allow-is-fullscreen',
    'core:window:allow-set-fullscreen'
  ];
  for (const permission of requiredOutputPermissions) {
    if (!permissions.has(permission)) {
      issues.push(`output capability must include ${permission}`);
    }
  }
  for (const forbidden of [
    'dialog:allow-open',
    'core:event:allow-emit-to',
    'core:webview:allow-create-webview-window',
    'core:window:allow-available-monitors',
    'core:window:allow-get-all-windows',
    'core:window:allow-set-focus',
    'core:window:allow-set-position',
    'core:window:allow-set-size',
    'core:window:allow-show',
    'process:allow-restart'
  ]) {
    if (permissions.has(forbidden)) {
      issues.push(`output capability must not include ${forbidden}`);
    }
  }
}

const infoPlist = await readFile(infoPlistPath, 'utf8');
for (const key of [
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSScreenCaptureUsageDescription',
  'NSAudioCaptureUsageDescription'
]) {
  if (!infoPlist.includes(`<key>${key}</key>`)) {
    issues.push(`Info.plist must include ${key}`);
  }
}

const releaseWorkflow = await readFile(releaseWorkflowPath, 'utf8');
const bundleJobStart = releaseWorkflow.indexOf('\n  bundle:');
const bundleStrategyStart = releaseWorkflow.indexOf('\n    strategy:', bundleJobStart);
const bundleJobHeader = bundleJobStart >= 0 && bundleStrategyStart > bundleJobStart
  ? releaseWorkflow.slice(bundleJobStart, bundleStrategyStart)
  : '';
for (const forbiddenJobEnvPrefix of ['ASCILINE_APPLE_', 'APPLE_', 'KEYCHAIN_PASSWORD']) {
  const pattern = new RegExp(`^      ${forbiddenJobEnvPrefix}`, 'm');
  if (pattern.test(bundleJobHeader)) {
    issues.push(`release workflow bundle job env must not define ${forbiddenJobEnvPrefix}*; scope Apple notarization env to notarization-only steps`);
  }
}

if (issues.length > 0) {
  console.error('Tauri policy check failed:');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log('Tauri policy check passed: local-only runtime policy with the configured GitHub updater endpoint exception.');
