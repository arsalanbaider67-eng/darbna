// Expo config plugin: signs release builds with YOUR upload key instead of the debug key.
// Reads the keystore location and passwords from environment variables at build time, so no
// secret ever lands in the repo or in the generated android/ project:
//   DARBNA_UPLOAD_STORE_FILE, DARBNA_UPLOAD_STORE_PASSWORD, DARBNA_UPLOAD_KEY_ALIAS, DARBNA_UPLOAD_KEY_PASSWORD
// If they are not set, release builds fall back to the debug key (fine for local testing only).
const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// darbna-release-signing";

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;

    // 1. Add an "upload" signing config next to the template's debug one.
    src = src.replace(
      /signingConfigs\s*\{/,
      `signingConfigs {
        ${MARKER}
        upload {
            def f = System.getenv("DARBNA_UPLOAD_STORE_FILE")
            if (f) {
                storeFile file(f)
                storePassword System.getenv("DARBNA_UPLOAD_STORE_PASSWORD")
                keyAlias System.getenv("DARBNA_UPLOAD_KEY_ALIAS")
                keyPassword System.getenv("DARBNA_UPLOAD_KEY_PASSWORD")
            }
        }`,
    );

    // 2. Use it for release when the env vars are present.
    src = src.replace(
      /(release\s*\{[^}]*?)signingConfig\s+signingConfigs\.debug/,
      `$1signingConfig System.getenv("DARBNA_UPLOAD_STORE_FILE") ? signingConfigs.upload : signingConfigs.debug`,
    );

    if (!src.includes("signingConfigs.upload : signingConfigs.debug")) {
      throw new Error("withReleaseSigning: could not find the release signingConfig in android/app/build.gradle");
    }
    cfg.modResults.contents = src;
    return cfg;
  });
};
