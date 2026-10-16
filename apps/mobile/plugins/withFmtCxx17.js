// Xcode 26.4+ (newer clang) fails to compile the "fmt" pod used by React Native 0.81 in C++20
// mode ("call to consteval function ... is not a constant expression"). Building just that pod as
// C++17 avoids fmt's consteval path. Adds a post_install hook to the generated Podfile.
const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("expo/config-plugins");

const MARK = "# darbna: fmt as C++17";
const SNIPPET = `
    ${MARK}
    installer.pods_project.targets.each do |t|
      if t.name == 'fmt'
        t.build_configurations.each { |c| c.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17' }
      end
    end`;

module.exports = function withFmtCxx17(config) {
  return withDangerousMod(config, ["ios", async (cfg) => {
    const file = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
    let src = fs.readFileSync(file, "utf8");
    if (!src.includes(MARK)) {
      if (!/post_install do \|installer\|/.test(src)) throw new Error("withFmtCxx17: no post_install block in Podfile");
      src = src.replace(/post_install do \|installer\|/, (m) => m + SNIPPET);
      fs.writeFileSync(file, src);
    }
    return cfg;
  }]);
};
