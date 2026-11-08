// Loaded before the app. A native error box would block the test forever, so it is recorded instead.
const { writeFileSync } = require('node:fs');

const { app, dialog } = require('electron');

const record = { errorBox: null, windowsOpened: 0 };

function save() {
  writeFileSync(process.env.POS_TEST_RECORD_PATH, JSON.stringify(record));
}

dialog.showErrorBox = (title, content) => {
  record.errorBox = { title, content };
  save();
};

app.on('browser-window-created', () => {
  record.windowsOpened += 1;
  save();
});
