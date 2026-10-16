// Sets the Android home-screen label to "دربنا" while the project name stays ASCII ("Darbna").
const { withStringsXml, AndroidConfig } = require("expo/config-plugins");

module.exports = function withArabicLabel(config) {
  return withStringsXml(config, (cfg) => {
    cfg.modResults = AndroidConfig.Strings.setStringItem(
      [{ $: { name: "app_name", translatable: "false" }, _: config.extra?.buildVariant === "preview" ? "دربنا تجربة" : "دربنا" }],
      cfg.modResults,
    );
    return cfg;
  });
};
