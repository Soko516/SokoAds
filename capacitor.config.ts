import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'tz.sokoads.app',
  appName: 'SokoAds',
  webDir: '.',
  server: {
    url: 'https://sokoads.onrender.com',
    cleartext: false
  }
};

export default config;
