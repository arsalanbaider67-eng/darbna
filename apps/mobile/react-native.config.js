// CarPlay's native module is only linked into builds made with DARBNA_CARPLAY=1 (Apple must grant
// the CarPlay entitlement first). Android Auto isn't used: never linked on Android.
const carplay = process.env.DARBNA_CARPLAY === "1";
module.exports = {
  dependencies: {
    "@g4rb4g3/react-native-carplay": { platforms: { ios: carplay ? undefined : null, android: null } },
  },
};
