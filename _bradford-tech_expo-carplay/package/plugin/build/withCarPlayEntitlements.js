"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withCarPlayEntitlements = void 0;
const config_plugins_1 = require("expo/config-plugins");
const withCarPlayEntitlements = config => {
    return (0, config_plugins_1.withEntitlementsPlist)(config, config => {
        config.modResults['com.apple.developer.carplay-maps'] = true;
        return config;
    });
};
exports.withCarPlayEntitlements = withCarPlayEntitlements;
