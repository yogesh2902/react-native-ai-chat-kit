// Resolves `react-native-ai-chat-kit` to the library source in ../src so edits
// hot-reload, while forcing a single copy of react / react-native from this app.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const libraryRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [libraryRoot];
// Files in ../src fall back to this app's node_modules (the library's own copy is blocked below).
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.extraNodeModules = {
  'react-native-ai-chat-kit': path.resolve(libraryRoot, 'src'),
};
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Don't crawl or resolve from the library's own node_modules (its dev copy of react-native).
config.resolver.blockList = [new RegExp(`^${escape(path.join(libraryRoot, 'node_modules'))}[/\\\\].*`)];

module.exports = config;
