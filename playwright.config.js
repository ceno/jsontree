const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:8080',
    headless: true,
  },
  webServer: {
    // -c-1 disables caching: http-server defaults to an hour of max-age, which
    // leaves a browser tab silently running an old build after an edit.
    command: 'npx http-server . -p 8080 --silent -c-1',
    port: 8080,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  reporter: [['list'], ['html', { open: 'never' }]],
});
