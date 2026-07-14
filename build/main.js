"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var http = __toESM(require("node:http"));
var https = __toESM(require("node:https"));
var utils = __toESM(require("@iobroker/adapter-core"));
var import_ws = __toESM(require("ws"));
var import_iobroker_jsonexplorer = __toESM(require("iobroker-jsonexplorer"));
var import_objectDefinitions = require("./lib/objectDefinitions");
const apConnection = [];
const messageResponse = {};
class OpenEpaperLink extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: "open-epaper-link"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("message", this.onMessage.bind(this));
    this.on("unload", this.onUnload.bind(this));
    import_iobroker_jsonexplorer.default.init(this, import_objectDefinitions.stateAttrb);
  }
  async onReady() {
    this.setState("info.connection", false, true);
    await this.connectConfiguredAccessPoints();
    await this.tryKnownDevices();
    this.setState("info.connection", true, true);
  }
  async connectConfiguredAccessPoints() {
    const configuredAccessPoints = this.getConfiguredAccessPoints();
    if (!configuredAccessPoints.length) {
      this.log.info("No configured access points found in adapter settings");
      return;
    }
    for (const configuredAccessPoint of configuredAccessPoints) {
      this.wsConnectionHandler(configuredAccessPoint.ip, configuredAccessPoint.apName);
    }
  }
  async tryKnownDevices() {
    try {
      this.log.info(`Try to connect to know devices`);
      const knownDevices = await this.getDevicesAsync();
      if (!knownDevices)
        return;
      for (const i in knownDevices) {
        const deviceDetails = knownDevices[i];
        if (!deviceDetails.native.ip)
          continue;
        this.wsConnectionHandler(deviceDetails.native.ip, deviceDetails.common.name);
      }
    } catch (error) {
    }
  }
  wsConnectionHandler(deviceIP, deviceName) {
    var _a, _b, _c;
    if (((_a = apConnection[deviceIP]) == null ? void 0 : _a.connectionStatus) === "Connected" || ((_b = apConnection[deviceIP]) == null ? void 0 : _b.connectionStatus) === "Connecting") {
      return;
    }
    if ((_c = apConnection[deviceIP]) == null ? void 0 : _c.connection) {
      try {
        apConnection[deviceIP].connection.close();
      } catch {
      }
    }
    this.log.info(`Starting connection to ${deviceName} on IP ${deviceIP}`);
    this.clearTagDatabaseRefreshTimer(deviceIP);
    apConnection[deviceIP] = {
      connection: new import_ws.default(`ws://${deviceIP}/ws`),
      connectionStatus: "Connecting",
      deviceName,
      ip: deviceIP
    };
    apConnection[deviceIP].connection.on("open", () => {
      this.log.info(
        `Connected to AccessPoint ${apConnection[deviceIP].deviceName} on ${apConnection[deviceIP].ip}`
      );
      apConnection[deviceIP].connectionStatus = "Connected";
      if (messageResponse[deviceIP]) {
        this.sendTo(
          messageResponse[deviceIP].from,
          messageResponse[deviceIP].command,
          {
            result: "OK - Access Point successfully connected, initializing configuration. Refresh table to show all known devices"
          },
          messageResponse[deviceIP].callback
        );
        delete messageResponse[deviceIP];
      }
      this.extendObject(apConnection[deviceIP].deviceName, {
        type: "device",
        common: {
          name: apConnection[deviceIP].deviceName
        },
        native: {
          ip: apConnection[deviceIP].ip
        }
      });
      this.extendObject(`${apConnection[deviceIP].deviceName}._info`, {
        type: "channel",
        common: {
          name: "Connection detail"
        }
      });
      this.extendObject(`${apConnection[deviceIP].deviceName}._info.ResetAP`, {
        type: "state",
        common: {
          name: "Restart Access Point",
          type: "boolean",
          read: true,
          write: true,
          role: "button",
          def: false
        },
        native: {}
      });
      import_iobroker_jsonexplorer.default.stateSetCreate(`${apConnection[deviceIP].deviceName}._info.connected`, "connected", true);
      import_iobroker_jsonexplorer.default.stateSetCreate(
        `${apConnection[deviceIP].deviceName}._info.ip`,
        "Access Point IP-Address",
        apConnection[deviceIP].ip
      );
      this.setState(`${apConnection[deviceIP].deviceName}._info.ResetAP`, false, true);
      void this.refreshTagDatabase(deviceIP).catch((error) => {
        this.log.warn(`Failed to load tag database from ${deviceIP}: ${error}`);
      });
      this.startTagDatabaseRefreshTimer(deviceIP);
    });
    apConnection[deviceIP].connection.on("message", (message) => {
      this.log.debug(`Received message from server: ${message}`);
      let parsedMessage;
      try {
        parsedMessage = JSON.parse(message);
      } catch (e) {
        this.log.error(`Cannot parse JSON ${message} | ${e}`);
        return;
      }
      let modifiedMessage;
      if (parsedMessage && parsedMessage["sys"]) {
        modifiedMessage = parsedMessage["sys"];
        import_iobroker_jsonexplorer.default.traverseJson(modifiedMessage, `${apConnection[deviceIP].deviceName}._info`);
      } else if (parsedMessage && parsedMessage["tags"]) {
        this.applyTagList(deviceIP, parsedMessage["tags"]);
      } else {
        modifiedMessage = parsedMessage;
        import_iobroker_jsonexplorer.default.traverseJson(modifiedMessage, apConnection[deviceIP].deviceName);
      }
      apConnection[deviceIP].connectionStatus = "Connected";
      import_iobroker_jsonexplorer.default.stateSetCreate(`${apConnection[deviceIP].deviceName}._info.connected`, "connected", true);
    });
    apConnection[deviceIP].connection.on("close", () => {
      this.log.info("Disconnected from server");
      this.clearTagDatabaseRefreshTimer(deviceIP);
      if (apConnection[deviceIP]) {
        apConnection[deviceIP].connectionStatus = "Disconnected";
        import_iobroker_jsonexplorer.default.stateSetCreate(`${apConnection[deviceIP].deviceName}._info.connected`, "connected", false);
      }
    });
  }
  onUnload(callback) {
    try {
      for (const ap in apConnection) {
        try {
          this.clearTagDatabaseRefreshTimer(ap);
          apConnection[ap].connection.close();
        } catch (e) {
        }
      }
      callback();
    } catch (e) {
      callback();
    }
  }
  async onStateChange(id, state) {
    var _a, _b;
    if (!state || state.ack) {
      return;
    }
    this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
    if (id.endsWith("._info.ResetAP")) {
      const namespacePrefix2 = `${this.namespace}.`;
      if (!id.startsWith(namespacePrefix2)) {
        return;
      }
      const relativeId2 = id.substring(namespacePrefix2.length);
      const resetSuffix = "._info.ResetAP";
      const deviceName2 = relativeId2.substring(0, relativeId2.length - resetSuffix.length);
      if (!deviceName2 || !state.val) {
        return;
      }
      const connectedEntry = Object.values(apConnection).find((entry) => entry.deviceName === deviceName2);
      const configuredEntry = this.getConfiguredAccessPoints().find((entry) => entry.apName === deviceName2);
      const deviceIP = (_a = connectedEntry == null ? void 0 : connectedEntry.ip) != null ? _a : configuredEntry == null ? void 0 : configuredEntry.ip;
      if (!deviceIP) {
        this.log.warn(`Cannot restart AP for ${id}: no IP configured for device ${deviceName2}`);
        this.setState(id, false, true);
        return;
      }
      try {
        await this.restartAccessPoint(deviceIP);
        this.log.info(`Restart request sent to access point ${deviceName2} (${deviceIP})`);
      } catch (error) {
        this.log.warn(`Failed to restart access point ${deviceName2} (${deviceIP}): ${error}`);
      }
      this.setState(id, false, true);
      return;
    }
    if (!id.endsWith(".JSONUpload")) {
      return;
    }
    const namespacePrefix = `${this.namespace}.`;
    if (!id.startsWith(namespacePrefix)) {
      return;
    }
    const relativeId = id.substring(namespacePrefix.length);
    const tagMarker = ".tags.";
    const tagMarkerIndex = relativeId.indexOf(tagMarker);
    if (tagMarkerIndex === -1) {
      return;
    }
    const deviceName = relativeId.substring(0, tagMarkerIndex);
    const mac = relativeId.substring(tagMarkerIndex + tagMarker.length, relativeId.length - ".JSONUpload".length);
    if (!deviceName || !mac) {
      return;
    }
    const connectionEntry = Object.values(apConnection).find((entry) => entry.deviceName === deviceName);
    if (!connectionEntry) {
      this.log.warn(`Cannot upload JSON for ${id}: access point ${deviceName} is not connected`);
      return;
    }
    const jsonValue = String((_b = state.val) != null ? _b : "");
    if (!jsonValue.trim()) {
      this.log.warn(`Cannot upload empty JSON for ${id}`);
      return;
    }
    try {
      JSON.parse(jsonValue);
    } catch (error) {
      this.log.warn(`Cannot upload invalid JSON for ${id}: ${error}`);
      return;
    }
    try {
      await this.postJsonUpload(connectionEntry.ip, mac, jsonValue);
      this.log.info(`Uploaded JSON for tag ${mac} via ${connectionEntry.ip}`);
      this.setState(id, jsonValue, true);
    } catch (error) {
      this.log.warn(`JSON upload failed for ${id}: ${error}`);
    }
  }
  async onMessage(obj) {
    this.log.debug("Data from configuration received : " + JSON.stringify(obj));
    if (typeof obj === "object" && obj.message) {
      this.log.debug("Data from configuration received : " + JSON.stringify(obj));
      try {
        switch (obj.command) {
          case "_addUpdateAP":
            const ipValid = this.validateIPAddress(obj.message["apIP"]);
            if (!ipValid) {
              this.log.warn(`You entered an incorrect IP-Address, cannot add device !`);
              this.sendTo(
                obj.from,
                obj.command,
                {
                  type: "error",
                  message: "connection failed"
                },
                obj.callback
              );
            } else {
              this.log.info(`Valid IP address received`);
              await this.upsertConfiguredAccessPoint(obj.message["apName"], obj.message["apIP"]);
              messageResponse[obj.message["apIP"]] = obj;
              this.wsConnectionHandler(obj.message["apIP"], obj.message["apName"]);
            }
            break;
          case "refreshTagDatabase":
            if (!obj.message["apIP"] || !apConnection[obj.message["apIP"]]) {
              this.sendTo(
                obj.from,
                obj.command,
                {
                  error: "Provided AP IP is not connected, refresh the AP connection first."
                },
                obj.callback
              );
              break;
            }
            await this.refreshTagDatabase(obj.message["apIP"]);
            this.sendTo(
              obj.from,
              obj.command,
              { result: "OK - Tag database refreshed" },
              obj.callback
            );
            break;
          case "loadAccessPoints":
            {
              let data = {};
              const tableEntryByIp = /* @__PURE__ */ new Map();
              for (const configuredAccessPoint of this.getConfiguredAccessPoints()) {
                tableEntryByIp.set(configuredAccessPoint.ip, {
                  apName: configuredAccessPoint.apName,
                  ip: configuredAccessPoint.ip,
                  connectState: "Disconnected"
                });
              }
              for (const device in apConnection) {
                tableEntryByIp.set(apConnection[device].ip, {
                  apName: apConnection[device].deviceName,
                  ip: apConnection[device].ip,
                  connectState: apConnection[device].connectionStatus
                });
              }
              const tableEntry = Array.from(tableEntryByIp.values());
              data = {
                native: {
                  accessPointTable: tableEntry
                }
              };
              this.sendTo(obj.from, obj.command, data, obj.callback);
            }
            break;
          case "getApName":
            {
              const dropDownEntryByName = /* @__PURE__ */ new Map();
              for (const configuredAccessPoint of this.getConfiguredAccessPoints()) {
                dropDownEntryByName.set(configuredAccessPoint.apName, {
                  label: configuredAccessPoint.apName,
                  value: configuredAccessPoint.apName
                });
              }
              for (const device in apConnection) {
                dropDownEntryByName.set(apConnection[device].deviceName, {
                  label: apConnection[device].deviceName,
                  value: apConnection[device].deviceName
                });
              }
              this.sendTo(obj.from, obj.command, Array.from(dropDownEntryByName.values()), obj.callback);
            }
            break;
          case "getApIP":
            {
              const dropDownEntryByIp = /* @__PURE__ */ new Map();
              for (const configuredAccessPoint of this.getConfiguredAccessPoints()) {
                dropDownEntryByIp.set(configuredAccessPoint.ip, {
                  label: configuredAccessPoint.ip,
                  value: configuredAccessPoint.ip
                });
              }
              for (const device in apConnection) {
                dropDownEntryByIp.set(apConnection[device].ip, {
                  label: apConnection[device].ip,
                  value: apConnection[device].ip
                });
              }
              this.sendTo(obj.from, obj.command, Array.from(dropDownEntryByIp.values()), obj.callback);
            }
            break;
          case "deleteAP":
            messageResponse[obj.message["apIP"]] = obj;
            await this.removeConfiguredAccessPoint(obj.message["apIP"]);
            if (apConnection[obj.message["apIP"]]) {
              this.clearTagDatabaseRefreshTimer(obj.message["apIP"]);
              try {
                if (apConnection[obj.message["apIP"]].connection)
                  apConnection[obj.message["apIP"]].connection.close();
              } catch (e) {
              }
              try {
                this.delObject(apConnection[obj.message["apIP"]].deviceName, { recursive: true });
              } catch (e) {
              }
              delete apConnection[obj.message["apIP"]];
              this.sendTo(
                messageResponse[obj.message["apIP"]].from,
                messageResponse[obj.message["apIP"]].command,
                { result: "OK - Device successfully removed" },
                messageResponse[obj.message["apIP"]].callback
              );
              delete messageResponse[obj.message["apIP"]];
            } else {
              this.sendTo(
                obj.from,
                obj.command,
                { result: "OK - Device removed from configuration" },
                obj.callback
              );
              delete messageResponse[obj.message["apIP"]];
            }
            break;
        }
      } catch (error) {
      }
    }
  }
  validateIPAddress(ipAddress) {
    return /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(
      ipAddress
    );
  }
  getConfiguredAccessPoints() {
    var _a, _b;
    const configWithAccessPoints = this.config;
    const configuredTable = Array.isArray(configWithAccessPoints.accessPointTable) ? configWithAccessPoints.accessPointTable : [];
    const entriesByIp = /* @__PURE__ */ new Map();
    for (const entry of configuredTable) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const ip = String((_a = entry.ip) != null ? _a : "").trim();
      const apName = String((_b = entry.apName) != null ? _b : "").trim();
      if (!ip || !apName || !this.validateIPAddress(ip)) {
        continue;
      }
      entriesByIp.set(ip, { ip, apName });
    }
    return Array.from(entriesByIp.values());
  }
  async saveConfiguredAccessPoints(accessPoints) {
    var _a;
    const normalizedAccessPoints = accessPoints.map((entry) => ({
      apName: entry.apName,
      ip: entry.ip
    }));
    const instanceObjectId = `system.adapter.${this.namespace}`;
    const instanceObject = await this.getForeignObjectAsync(instanceObjectId);
    if (!instanceObject) {
      throw new Error(`Adapter instance object ${instanceObjectId} not found`);
    }
    instanceObject.native = (_a = instanceObject.native) != null ? _a : {};
    instanceObject.native.accessPointTable = normalizedAccessPoints;
    await this.setForeignObjectAsync(instanceObjectId, instanceObject);
    this.config.accessPointTable = normalizedAccessPoints;
  }
  async upsertConfiguredAccessPoint(apName, ip) {
    const configuredAccessPoints = this.getConfiguredAccessPoints().filter((entry) => entry.ip !== ip);
    configuredAccessPoints.push({ apName: apName.trim(), ip: ip.trim() });
    await this.saveConfiguredAccessPoints(configuredAccessPoints);
  }
  async removeConfiguredAccessPoint(ip) {
    const normalizedIp = String(ip != null ? ip : "").trim();
    if (!normalizedIp) {
      return;
    }
    const configuredAccessPoints = this.getConfiguredAccessPoints().filter((entry) => entry.ip !== normalizedIp);
    await this.saveConfiguredAccessPoints(configuredAccessPoints);
  }
  async refreshTagDatabase(deviceIP) {
    let position = 0;
    let loadedTags = 0;
    while (true) {
      const response = await this.fetchJson(
        `http://${deviceIP}/get_db?pos=${position}`
      );
      if (!response) {
        return;
      }
      const tags = Array.isArray(response.tags) ? response.tags : [];
      this.applyTagList(deviceIP, tags);
      loadedTags += tags.length;
      if (typeof response.continu !== "number" || response.continu <= position) {
        break;
      }
      position = response.continu;
    }
    this.log.debug(`Loaded ${loadedTags} tags from AP ${deviceIP}`);
  }
  applyTagList(deviceIP, tags) {
    this.extendObject(`${apConnection[deviceIP].deviceName}.tags`, {
      type: "channel",
      common: {
        name: "Tags"
      }
    });
    for (const tag of tags) {
      this.applyTagRecord(deviceIP, tag);
    }
  }
  applyTagRecord(deviceIP, tag) {
    var _a, _b;
    const mac = String((_a = tag.mac) != null ? _a : "").toUpperCase();
    if (!mac) {
      return;
    }
    this.extendObject(`${apConnection[deviceIP].deviceName}.tags.${mac}`, {
      type: "channel",
      common: {
        name: String((_b = tag.alias) != null ? _b : mac)
      }
    });
    this.extendObject(`${apConnection[deviceIP].deviceName}.tags.${mac}.JSONUpload`, {
      type: "state",
      common: {
        name: "JSON Upload",
        type: "string",
        read: true,
        write: true,
        role: "text",
        def: ""
      },
      native: {}
    });
    this.setState(`${apConnection[deviceIP].deviceName}.tags.${mac}.JSONUpload`, "", true);
    import_iobroker_jsonexplorer.default.traverseJson(tag, `${apConnection[deviceIP].deviceName}.tags.${mac}`);
  }
  async fetchJson(url) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === "https:" ? https : http;
      const request = client.get(parsedUrl, (response) => {
        var _a;
        const statusCode = (_a = response.statusCode) != null ? _a : 0;
        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`HTTP ${statusCode}`));
          return;
        }
        let responseBody = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(responseBody));
          } catch (error) {
            reject(error);
          }
        });
      });
      request.on("error", (error) => reject(error));
    });
  }
  async postJsonUpload(deviceIP, mac, jsonValue) {
    const response = await fetch(`http://${deviceIP}/jsonupload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        mac,
        json: jsonValue
      })
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  }
  async restartAccessPoint(deviceIP) {
    const restartCandidates = [
      { method: "POST", path: "/reboot" },
      { method: "GET", path: "/reboot" },
      { method: "POST", path: "/restart" },
      { method: "GET", path: "/restart" }
    ];
    let lastError = "unknown error";
    for (const candidate of restartCandidates) {
      try {
        const response = await fetch(`http://${deviceIP}${candidate.path}`, {
          method: candidate.method
        });
        if (response.ok) {
          return;
        }
        lastError = `${candidate.method} ${candidate.path} returned HTTP ${response.status}`;
      } catch (error) {
        lastError = `${candidate.method} ${candidate.path} failed: ${error}`;
      }
    }
    throw new Error(lastError);
  }
  startTagDatabaseRefreshTimer(deviceIP) {
    this.clearTagDatabaseRefreshTimer(deviceIP);
    if (!apConnection[deviceIP]) {
      return;
    }
    apConnection[deviceIP].tagRefreshTimer = setInterval(() => {
      void this.refreshTagDatabase(deviceIP).catch((error) => {
        this.log.warn(`Failed to refresh tag database from ${deviceIP}: ${error}`);
      });
    }, 5 * 60 * 1e3);
  }
  clearTagDatabaseRefreshTimer(deviceIP) {
    var _a;
    if ((_a = apConnection[deviceIP]) == null ? void 0 : _a.tagRefreshTimer) {
      clearInterval(apConnection[deviceIP].tagRefreshTimer);
      delete apConnection[deviceIP].tagRefreshTimer;
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new OpenEpaperLink(options);
} else {
  (() => new OpenEpaperLink())();
}
//# sourceMappingURL=main.js.map
