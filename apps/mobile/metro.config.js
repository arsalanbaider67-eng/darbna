// Metro config for the monorepo: the app lives in apps/mobile, shared code in packages/core,
// and npm workspaces hoist most dependencies to the repo-root node_modules.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [repoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(repoRoot, "node_modules"),
];
// Resolve the shared package straight from source (no build step, no reliance on symlinks).
config.resolver.extraNodeModules = {
  "@darbna/core": path.resolve(repoRoot, "packages/core"),
};

module.exports = config;
