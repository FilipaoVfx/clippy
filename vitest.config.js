const { defineConfig } = require('vitest/config');
const path = require('path');

module.exports = defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': path.resolve(__dirname, 'tests/__mocks__/cloudflare-workers.js'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    coverage: {
      include: ['server/**', 'cloudflare/**'],
    },
  },
});
