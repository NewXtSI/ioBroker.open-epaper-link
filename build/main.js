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
var utils = __toESM(require("@iobroker/adapter-core"));
var import_http = require("node:http");
var import_https = require("node:https");
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
    await this.tryKnownDevices();
    this.setState("info.connection", true, true);
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
    this.log.info(`Starting connection to ${deviceName} on IP ${deviceIP}`);
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
      import_iobroker_jsonexplorer.default.stateSetCreate(`${apConnection[deviceIP].deviceName}._info.connected`, "connected", true);
      import_iobroker_jsonexplorer.default.stateSetCreate(
        `${apConnection[deviceIP].deviceName}._info.ip`,
        "Access Point IP-Address",
        apConnection[deviceIP].ip
      );
      void this.refreshTagDatabase(deviceIP).catch((error) => {
        this.log.warn(`Failed to load tag database from ${deviceIP}: ${error}`);
      });
      this.startTagDatabaseRefreshTimer(deviceIP);
    });
    apConnection[deviceIP].connection.on("message", (message) => {
      this.log.debug(`Received message from server: ${message}`);
      try {
        message = JSON.parse(message);
      } catch (e) {
        this.log.error(`Cannot parse JSON ${message} | ${e} | ${e.stack}`)
      }

      let modifiedMessage;
      if (message && message["sys"]) {
        modifiedMessage = message["sys"];
        import_iobroker_jsonexplorer.default.traverseJson(modifiedMessage, `${apConnection[deviceIP].deviceName}._info`);
      } else if (message && message["tags"]) {
        this.applyTagList(deviceIP, message["tags"]);
      } else {
        modifiedMessage = message;
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
    if (!state || state.ack) {
      return;
    }
    this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
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
    const jsonValue = String(state.val ?? "");
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
              const tableEntry = [];
              for (const device in apConnection) {
                tableEntry.push({
                  apName: apConnection[device].deviceName,
                  ip: apConnection[device].ip,
                  connectState: apConnection[device].connectionStatus
                });
              }
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
              const dropDownEntry = [];
              for (const device in apConnection) {
                dropDownEntry.push({
                  label: apConnection[device].deviceName,
                  value: apConnection[device].deviceName
                });
              }
              this.sendTo(obj.from, obj.command, dropDownEntry, obj.callback);
            }
            break;
          case "getApIP":
            {
              const dropDownEntry = [];
              for (const device in apConnection) {
                dropDownEntry.push({
                  label: apConnection[device].ip,
                  value: apConnection[device].ip
                });
              }
              this.sendTo(obj.from, obj.command, dropDownEntry, obj.callback);
            }
            break;
          case "deleteAP":
            messageResponse[obj.message["apIP"]] = obj;
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
                {
                  error: `Provided IP-Address ${JSON.stringify(
                    obj.message
                  )} unknown, please refresh table and enter an valid IP-Address`
                },
                obj.callback
              );
              return;
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
  async refreshTagDatabase(deviceIP) {
    let position = 0;
    let loadedTags = 0;
    while (true) {
      const response = await this.fetchJson(`http://${deviceIP}/get_db?pos=${position}`);
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
    const mac = String(tag.mac ?? "").toUpperCase();
    if (!mac) {
      return;
    }
    this.extendObject(`${apConnection[deviceIP].deviceName}.tags.${mac}`, {
      type: "channel",
      common: {
        name: String(tag.alias ?? mac)
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
  fetchJson(url) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === "https:" ? import_https : import_http;
      const request = client.get(parsedUrl, (response) => {
        const statusCode = response.statusCode ?? 0;
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
  startTagDatabaseRefreshTimer(deviceIP) {
    this.clearTagDatabaseRefreshTimer(deviceIP);
    if (!apConnection[deviceIP]) {
      return;
    }
    apConnection[deviceIP].tagRefreshTimer = setInterval(() => {
      void this.refreshTagDatabase(deviceIP).catch((error) => {
        this.log.warn(`Failed to refresh tag database from ${deviceIP}: ${error}`);
      });
    }, 5 * 60 * 1000);
  }
  clearTagDatabaseRefreshTimer(deviceIP) {
    if (apConnection[deviceIP]?.tagRefreshTimer) {
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
