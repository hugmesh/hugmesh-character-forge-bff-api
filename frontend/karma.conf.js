// Karma configuration for the character-forge unit tests. `npm test` runs
// `ng test character-forge --watch=false --browsers=ChromeHeadlessCI`; the
// ChromeHeadlessCI launcher below is headless Chrome hardened for CI /
// sandboxed environments (no sandbox, no GPU, no /dev/shm).
//
// CHROME_BIN resolution: karma-chrome-launcher only reads process.env.CHROME_BIN, so a
// machine with Chrome installed under any of the usual names otherwise fails with a bare
// "No binary for ChromeHeadless browser on your platform". Resolve it here — env first,
// then the standard binaries — and ABORT LOUDLY when nothing is found, so this suite can
// never be skipped-but-green.
const fs = require('fs');

const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/google/chrome/chrome',
  '/snap/bin/chromium',
];

function resolveChromeBin() {
  const fromEnv = process.env['CHROME_BIN'];
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }
  const found = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      'No Chrome/Chromium binary found for the headless karma run. Install one, or set '
        + 'CHROME_BIN to its path. Looked at: ' + CHROME_CANDIDATES.join(', '),
    );
  }
  return found;
}

process.env['CHROME_BIN'] = resolveChromeBin();

module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
    ],
    client: {
      clearContext: false, // leave the Jasmine Spec Runner output visible when watching
    },
    jasmineHtmlReporter: {
      suppressAll: true, // removes the duplicated traces
    },
    coverageReporter: {
      dir: require('path').join(__dirname, './coverage/character-forge'),
      subdir: '.',
      reporters: [{ type: 'html' }, { type: 'text-summary' }],
    },
    reporters: ['progress', 'kjhtml'],
    browsers: ['Chrome'],
    customLaunchers: {
      ChromeHeadlessCI: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      },
    },
    // A run that executes ZERO specs must FAIL: an empty suite is the classic
    // false-green (a broken import or a bad include glob looks exactly like
    // "everything passed").
    failOnEmptyTestSuite: true,
    restartOnFileChange: true,
  });
};
