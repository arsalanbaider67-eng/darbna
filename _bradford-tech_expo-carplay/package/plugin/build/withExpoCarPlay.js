"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_plugins_1 = require("expo/config-plugins");
const withCarPlayEntitlements_1 = require("./withCarPlayEntitlements");
const withCarPlayInfoPlist_1 = require("./withCarPlayInfoPlist");
const pkg = require('../../package.json');
const withExpoCarPlay = config => {
    config = (0, withCarPlayInfoPlist_1.withCarPlayInfoPlist)(config);
    config = (0, withCarPlayEntitlements_1.withCarPlayEntitlements)(config);
    return config;
};
exports.default = (0, config_plugins_1.createRunOncePlugin)(withExpoCarPlay, pkg.name, pkg.version);
