const fs = require('fs');
const path = require('path');

const srcDir = __dirname;
const distDir = path.join(__dirname, 'dist');
const chromeDist = path.join(distDir, 'chrome');
const firefoxDist = path.join(distDir, 'firefox');

// Ensure dist directories exist
[distDir, chromeDist, firefoxDist].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Copy folder recursively
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'dist' && entry.name !== '.git') {
        copyDir(srcPath, destPath);
      }
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy source files to both dist folders
const filesToCopy = ['background.js', 'icon16.png', 'icon32.png', 'icon48.png', 'icon128.png', 'popup'];
filesToCopy.forEach(item => {
  const srcPath = path.join(srcDir, item);
  if (!fs.existsSync(srcPath)) return;
  
  if (fs.lstatSync(srcPath).isDirectory()) {
    copyDir(srcPath, path.join(chromeDist, item));
    copyDir(srcPath, path.join(firefoxDist, item));
  } else {
    fs.copyFileSync(srcPath, path.join(chromeDist, item));
    fs.copyFileSync(srcPath, path.join(firefoxDist, item));
  }
});

// Read base manifest
const manifest = JSON.parse(fs.readFileSync(path.join(srcDir, 'manifest.json'), 'utf8'));

// Generate Chrome Manifest (remove Firefox-specific keys)
const chromeManifest = { ...manifest };
delete chromeManifest.browser_specific_settings;
if (chromeManifest.background) {
  chromeManifest.background = {
    service_worker: chromeManifest.background.service_worker
  };
}
fs.writeFileSync(
  path.join(chromeDist, 'manifest.json'),
  JSON.stringify(chromeManifest, null, 2),
  'utf8'
);

// Generate Firefox Manifest (remove Chrome-specific keys, or keep scripts)
const firefoxManifest = { ...manifest };
if (firefoxManifest.background) {
  firefoxManifest.background = {
    scripts: firefoxManifest.background.scripts
  };
}
fs.writeFileSync(
  path.join(firefoxDist, 'manifest.json'),
  JSON.stringify(firefoxManifest, null, 2),
  'utf8'
);

console.log('Build completed successfully!');
console.log('- Chrome extension: dist/chrome');
console.log('- Firefox extension: dist/firefox');
