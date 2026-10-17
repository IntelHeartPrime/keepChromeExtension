const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: {
    browserName: 'chromium',
    channel: 'chrome',
    viewport: { width: 1100, height: 850 },
    screenshot: 'only-on-failure'
  }
});
