/*
 * Created with @iobroker/create-adapter v2.5.0
 */

import * as http from 'node:http';
import * as https from 'node:https';

type ApConnection = {
	[key: string]: {
		ip: string;
		connection: WebSocket;
		connectionStatus: string;
		deviceName: string;
		tagRefreshTimer?: NodeJS.Timeout;
	};
};

type ConfiguredAccessPoint = {
	apName: string;
	ip: string;
};

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from '@iobroker/adapter-core';
import WebSocket from 'ws';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
const apConnection: ApConnection = [];
const messageResponse: any = {};

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
import jsonExplorer from 'iobroker-jsonexplorer'; // Use jsonExplorer library
import { stateAttrb } from './lib/objectDefinitions';

// Load your modules here, e.g.:
// import * as fs from "fs";

class OpenEpaperLink extends utils.Adapter {
	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({
			...options,
			name: 'open-epaper-link',
		});
		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		this.on('message', this.onMessage.bind(this));
		this.on('unload', this.onUnload.bind(this));
		jsonExplorer.init(this, stateAttrb); // Initiate library to handle JSOn data & state creation
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	private async onReady(): Promise<void> {
		// Initialize your adapter here

		// Reset the connection indicator during startup
		this.setState('info.connection', false, true);

		await this.connectConfiguredAccessPoints();

		// Try to connect to known devices from object tree as fallback
		await this.tryKnownDevices();
		this.setState('info.connection', true, true);
	}

	private async connectConfiguredAccessPoints(): Promise<void> {
		const configuredAccessPoints = this.getConfiguredAccessPoints();
		if (!configuredAccessPoints.length) {
			this.log.info('No configured access points found in adapter settings');
			return;
		}

		for (const configuredAccessPoint of configuredAccessPoints) {
			this.wsConnectionHandler(configuredAccessPoint.ip, configuredAccessPoint.apName);
		}
	}

	// Try to contact and read data of already known devices
	private async tryKnownDevices(): Promise<void> {
		try {
			// Get all current devices from adapter tree
			this.log.info(`Try to connect to know devices`);
			const knownDevices = await this.getDevicesAsync();

			// Cancel operation if no devices are found
			if (!knownDevices) return;

			// Get connection data of known devices and to connect
			for (const i in knownDevices) {
				const deviceDetails = knownDevices[i];
				// Cancell operation if object does not contain IP address
				if (!deviceDetails.native.ip) continue;
				// Start connection to this device
				// eslint-disable-next-line @typescript-eslint/ban-ts-comment
				// @ts-expect-error
				this.wsConnectionHandler(deviceDetails.native.ip, deviceDetails.common.name);
			}
		} catch (error) {
			// this.errorHandler(`[tryKnownDevices]`, error);
		}
	}

	private wsConnectionHandler(deviceIP: string, deviceName: string): void {
		if (apConnection[deviceIP]?.connectionStatus === 'Connected' || apConnection[deviceIP]?.connectionStatus === 'Connecting') {
			return;
		}

		if (apConnection[deviceIP]?.connection) {
			try {
				apConnection[deviceIP].connection.close();
			} catch {
				// Ignore close errors and continue with reconnect
			}
		}

		this.log.info(`Starting connection to ${deviceName} on IP ${deviceIP}`);
		this.clearTagDatabaseRefreshTimer(deviceIP);
		apConnection[deviceIP] = {
			connection: new WebSocket(`ws://${deviceIP}/ws`),
			connectionStatus: 'Connecting',
			deviceName: deviceName,
			ip: deviceIP,
		};

		apConnection[deviceIP].connection.on('open', () => {
			this.log.info(
				`Connected to AccessPoint ${apConnection[deviceIP].deviceName} on ${apConnection[deviceIP].ip}`,
			);
			apConnection[deviceIP].connectionStatus = 'Connected';

			// Check if device connection is caused by adding  device from admin, if yes send OK message
			if (messageResponse[deviceIP]) {
				this.sendTo(
					messageResponse[deviceIP].from,
					messageResponse[deviceIP].command,
					{
						result: 'OK - Access Point successfully connected, initializing configuration. Refresh table to show all known devices',
					},
					messageResponse[deviceIP].callback,
				);
				delete messageResponse[deviceIP];
			}

			//ToDo: Create Device on connection state and store decide details
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			this.extendObject(apConnection[deviceIP].deviceName, {
				type: 'device',
				common: {
					name: apConnection[deviceIP].deviceName,
					// ToDo: @ticaki please assit with TS, value is correct but error shown
					// statusStates: {
					// 	onlineId: `${this.namespace}.${apConnection[deviceIP].deviceName}._info._online`,
					// },
				},
				native: {
					ip: apConnection[deviceIP].ip,
				},
			});
			this.extendObject(`${apConnection[deviceIP].deviceName}._info`, {
				type: 'channel',
				common: {
					name: 'Connection detail',
				},
			});

			jsonExplorer.stateSetCreate(`${apConnection[deviceIP].deviceName}._info.connected`, 'connected', true);
			jsonExplorer.stateSetCreate(
				`${apConnection[deviceIP].deviceName}._info.ip`,
				'Access Point IP-Address',
				apConnection[deviceIP].ip,
			);

			void this.refreshTagDatabase(deviceIP).catch((error) => {
				this.log.warn(`Failed to load tag database from ${deviceIP}: ${error}`);
			});
			this.startTagDatabaseRefreshTimer(deviceIP);
		});

		apConnection[deviceIP].connection.on('message', (message: string) => {
			//ToDo: Design messageHandler to write values to states
			this.log.debug(`Received message from server: ${message}`);
			try {
				message = JSON.parse(message);
			} catch (e) {
				this.log.error(`Cannot parse JSON ${message} | ${e}`);
			}
			let modifiedMessage;

			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			// @ts-expect-error
			if (message && message['sys']) {
				// eslint-disable-next-line @typescript-eslint/ban-ts-comment
				// @ts-expect-error
				modifiedMessage = message['sys'];
				jsonExplorer.traverseJson(modifiedMessage, `${apConnection[deviceIP].deviceName}._info`);
				// eslint-disable-next-line @typescript-eslint/ban-ts-comment
				// @ts-expect-error
			} else if (message && message['tags']) {
				this.applyTagList(deviceIP, message['tags']);
			} else {
				modifiedMessage = message;
				jsonExplorer.traverseJson(modifiedMessage, apConnection[deviceIP].deviceName);
			}
			apConnection[deviceIP].connectionStatus = 'Connected';
			jsonExplorer.stateSetCreate(`${apConnection[deviceIP].deviceName}._info.connected`, 'connected', true);
		});

		apConnection[deviceIP].connection.on('close', () => {
			this.log.info('Disconnected from server');
			this.clearTagDatabaseRefreshTimer(deviceIP);
			if (apConnection[deviceIP]) {
				apConnection[deviceIP].connectionStatus = 'Disconnected';
				jsonExplorer.stateSetCreate(`${apConnection[deviceIP].deviceName}._info.connected`, 'connected', false);
			}
		});
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 */
	private onUnload(callback: () => void): void {
		try {
			// Here you must clear all timeouts or intervals that may still be active
			// clearTimeout(timeout1);
			// clearTimeout(timeout2);
			// ...
			// clearInterval(interval1);

			// loop truth all connection and close if present
			for (const ap in apConnection) {
				//ToDo: needs to be optimized, just quick & dirty for testing now
				try {
					this.clearTagDatabaseRefreshTimer(ap);
					apConnection[ap].connection.close();
				} catch (e) {
					// no connection present
				}
			}

			callback();
		} catch (e) {
			callback();
		}
	}

	/**
	 * Is called if a subscribed state changes
	 */
	private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
		if (!state || state.ack) {
			return;
		}

		this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);

		if (!id.endsWith('.JSONUpload')) {
			return;
		}

		const namespacePrefix = `${this.namespace}.`;
		if (!id.startsWith(namespacePrefix)) {
			return;
		}

		const relativeId = id.substring(namespacePrefix.length);
		const tagMarker = '.tags.';
		const tagMarkerIndex = relativeId.indexOf(tagMarker);
		if (tagMarkerIndex === -1) {
			return;
		}

		const deviceName = relativeId.substring(0, tagMarkerIndex);
		const mac = relativeId.substring(tagMarkerIndex + tagMarker.length, relativeId.length - '.JSONUpload'.length);
		if (!deviceName || !mac) {
			return;
		}

		const connectionEntry = Object.values(apConnection).find((entry) => entry.deviceName === deviceName);
		if (!connectionEntry) {
			this.log.warn(`Cannot upload JSON for ${id}: access point ${deviceName} is not connected`);
			return;
		}

		const jsonValue = String(state.val ?? '');
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

	// If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
	/**
	 * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
	 * Using this method requires "common.messagebox" property to be set to true in io-package.json
	 */
	private async onMessage(obj: ioBroker.Message): Promise<void> {
		this.log.debug('Data from configuration received : ' + JSON.stringify(obj));
		if (typeof obj === 'object' && obj.message) {
			this.log.debug('Data from configuration received : ' + JSON.stringify(obj));
			// if (obj.command === 'send') {
			// e.g. send email or pushover or whatever

			try {
				switch (obj.command) {
					//ToDo previous add function to be removed
					case '_addUpdateAP':
						// eslint-disable-next-line no-case-declarations
						const ipValid = this.validateIPAddress(obj.message['apIP']);
						if (!ipValid) {
							this.log.warn(`You entered an incorrect IP-Address, cannot add device !`);

							this.sendTo(
								obj.from,
								obj.command,
								{
									type: 'error',
									message: 'connection failed',
								},
								obj.callback,
							);
						} else {
							this.log.info(`Valid IP address received`);
							await this.upsertConfiguredAccessPoint(obj.message['apName'], obj.message['apIP']);
							messageResponse[obj.message['apIP']] = obj;
							this.wsConnectionHandler(obj.message['apIP'], obj.message['apName']);
						}
						break;
					case 'refreshTagDatabase':
						if (!obj.message['apIP'] || !apConnection[obj.message['apIP']]) {
							this.sendTo(
								obj.from,
								obj.command,
								{
									error: 'Provided AP IP is not connected, refresh the AP connection first.',
								},
								obj.callback,
							);
							break;
						}
						await this.refreshTagDatabase(obj.message['apIP']);
						this.sendTo(
							obj.from,
							obj.command,
							{ result: 'OK - Tag database refreshed' },
							obj.callback,
						);
						break;
					//
					case 'loadAccessPoints':
						{
							let data = {};

							const tableEntryByIp = new Map<string, { apName: string; ip: string; connectState: string }>();
							for (const configuredAccessPoint of this.getConfiguredAccessPoints()) {
								tableEntryByIp.set(configuredAccessPoint.ip, {
									apName: configuredAccessPoint.apName,
									ip: configuredAccessPoint.ip,
									connectState: 'Disconnected',
								});
							}
							for (const device in apConnection) {
								tableEntryByIp.set(apConnection[device].ip, {
									apName: apConnection[device].deviceName,
									ip: apConnection[device].ip,
									connectState: apConnection[device].connectionStatus,
								});
							}

							const tableEntry = Array.from(tableEntryByIp.values());

							data = {
								native: {
									accessPointTable: tableEntry,
								},
							};
							this.sendTo(obj.from, obj.command, data, obj.callback);
						}
						break;
					//
					// Front End message handler to load IP-Address dropDown with all current known devices
					case 'getApName':
						{
							const dropDownEntryByName = new Map<string, { label: string; value: string }>();
							for (const configuredAccessPoint of this.getConfiguredAccessPoints()) {
								dropDownEntryByName.set(configuredAccessPoint.apName, {
									label: configuredAccessPoint.apName,
									value: configuredAccessPoint.apName,
								});
							}
							for (const device in apConnection) {
								dropDownEntryByName.set(apConnection[device].deviceName, {
									label: apConnection[device].deviceName,
									value: apConnection[device].deviceName,
								});
							}
							this.sendTo(obj.from, obj.command, Array.from(dropDownEntryByName.values()), obj.callback);
						}
						break;

					case 'getApIP':
						{
							const dropDownEntryByIp = new Map<string, { label: string; value: string }>();
							for (const configuredAccessPoint of this.getConfiguredAccessPoints()) {
								dropDownEntryByIp.set(configuredAccessPoint.ip, {
									label: configuredAccessPoint.ip,
									value: configuredAccessPoint.ip,
								});
							}
							for (const device in apConnection) {
								dropDownEntryByIp.set(apConnection[device].ip, {
									label: apConnection[device].ip,
									value: apConnection[device].ip,
								});
							}
							this.sendTo(obj.from, obj.command, Array.from(dropDownEntryByIp.values()), obj.callback);
						}
						break;

					// Handle front-end messages to delete devices
					case 'deleteAP':
						messageResponse[obj.message['apIP']] = obj;
						await this.removeConfiguredAccessPoint(obj.message['apIP']);
						if (apConnection[obj.message['apIP']]) {
							this.clearTagDatabaseRefreshTimer(obj.message['apIP']);
							// Ensure all existing connections are closed, will trigger disconnect event to clean-up memory attributes
							try {
								if (apConnection[obj.message['apIP']].connection)
									apConnection[obj.message['apIP']].connection.close();
							} catch (e) {
								// Add error handler
							}
							// Try to delete Device Object including all underlying states
							try {
								this.delObject(apConnection[obj.message['apIP']].deviceName, { recursive: true });
							} catch (e) {
								// Deleting device channel failed
							}

							// Clean memory data
							delete apConnection[obj.message['apIP']];

							// Send confirmation to frontend
							this.sendTo(
								messageResponse[obj.message['apIP']].from,
								messageResponse[obj.message['apIP']].command,
								{ result: 'OK - Device successfully removed' },
								messageResponse[obj.message['apIP']].callback,
							);
							delete messageResponse[obj.message['apIP']];
						} else {
							this.sendTo(
								obj.from,
								obj.command,
								{ result: 'OK - Device removed from configuration' },
								obj.callback,
							);
							delete messageResponse[obj.message['apIP']];
						}

						// this.sendTo(obj.from, obj.command, 1, obj.callback);
						break;
				}
			} catch (error) {
				// this.errorHandler(`[onMessage]`, error);
			}

			// Send response in callback if required
			// if (obj.callback) this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
			// }
		}
	}

	private validateIPAddress(ipAddress: string): boolean {
		return /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(
			ipAddress,
		);
	}

	private getConfiguredAccessPoints(): ConfiguredAccessPoint[] {
		const configuredTable = Array.isArray(this.config.accessPointTable) ? this.config.accessPointTable : [];
		const entriesByIp = new Map<string, ConfiguredAccessPoint>();

		for (const entry of configuredTable) {
			if (!entry || typeof entry !== 'object') {
				continue;
			}

			const ip = String((entry as Record<string, unknown>).ip ?? '').trim();
			const apName = String((entry as Record<string, unknown>).apName ?? '').trim();
			if (!ip || !apName || !this.validateIPAddress(ip)) {
				continue;
			}

			entriesByIp.set(ip, { ip, apName });
		}

		return Array.from(entriesByIp.values());
	}

	private async saveConfiguredAccessPoints(accessPoints: ConfiguredAccessPoint[]): Promise<void> {
		const normalizedAccessPoints = accessPoints.map((entry) => ({
			apName: entry.apName,
			ip: entry.ip,
		}));

		const instanceObjectId = `system.adapter.${this.namespace}`;
		const instanceObject = await this.getForeignObjectAsync(instanceObjectId);
		if (!instanceObject) {
			throw new Error(`Adapter instance object ${instanceObjectId} not found`);
		}

		instanceObject.native = instanceObject.native ?? {};
		instanceObject.native.accessPointTable = normalizedAccessPoints;
		await this.setForeignObjectAsync(instanceObjectId, instanceObject);

		this.config.accessPointTable = normalizedAccessPoints;
	}

	private async upsertConfiguredAccessPoint(apName: string, ip: string): Promise<void> {
		const configuredAccessPoints = this.getConfiguredAccessPoints().filter((entry) => entry.ip !== ip);
		configuredAccessPoints.push({ apName: apName.trim(), ip: ip.trim() });
		await this.saveConfiguredAccessPoints(configuredAccessPoints);
	}

	private async removeConfiguredAccessPoint(ip: string): Promise<void> {
		const normalizedIp = String(ip ?? '').trim();
		if (!normalizedIp) {
			return;
		}

		const configuredAccessPoints = this.getConfiguredAccessPoints().filter((entry) => entry.ip !== normalizedIp);
		await this.saveConfiguredAccessPoints(configuredAccessPoints);
	}

	private async refreshTagDatabase(deviceIP: string): Promise<void> {
		let position = 0;
		let loadedTags = 0;

		while (true) {
			const response = await this.fetchJson<{ tags?: Array<Record<string, unknown>>; continu?: number }>(
				`http://${deviceIP}/get_db?pos=${position}`,
			);
			if (!response) {
				return;
			}

			const tags = Array.isArray(response.tags) ? response.tags : [];
			this.applyTagList(deviceIP, tags);
			loadedTags += tags.length;

			if (typeof response.continu !== 'number' || response.continu <= position) {
				break;
			}

			position = response.continu;
		}

		this.log.debug(`Loaded ${loadedTags} tags from AP ${deviceIP}`);
	}

	private applyTagList(deviceIP: string, tags: Array<Record<string, unknown>>): void {
		this.extendObject(`${apConnection[deviceIP].deviceName}.tags`, {
			type: 'channel',
			common: {
				name: 'Tags',
			},
		});

		for (const tag of tags) {
			this.applyTagRecord(deviceIP, tag);
		}
	}

	private applyTagRecord(deviceIP: string, tag: Record<string, unknown>): void {
		const mac = String(tag.mac ?? '').toUpperCase();
		if (!mac) {
			return;
		}

		this.extendObject(`${apConnection[deviceIP].deviceName}.tags.${mac}`, {
			type: 'channel',
			common: {
				name: String(tag.alias ?? mac),
			},
		});
		this.extendObject(`${apConnection[deviceIP].deviceName}.tags.${mac}.JSONUpload`, {
			type: 'state',
			common: {
				name: 'JSON Upload',
				type: 'string',
				read: true,
				write: true,
				role: 'text',
				def: '',
			},
			native: {},
		});
		this.setState(`${apConnection[deviceIP].deviceName}.tags.${mac}.JSONUpload`, '', true);
		jsonExplorer.traverseJson(tag, `${apConnection[deviceIP].deviceName}.tags.${mac}`);
	}

	private async fetchJson<T>(url: string): Promise<T | null> {
		return new Promise((resolve, reject) => {
			const parsedUrl = new URL(url);
			const client = parsedUrl.protocol === 'https:' ? https : http;

			const request = client.get(parsedUrl, (response) => {
				const statusCode = response.statusCode ?? 0;
				if (statusCode < 200 || statusCode >= 300) {
					response.resume();
					reject(new Error(`HTTP ${statusCode}`));
					return;
				}

				let responseBody = '';
				response.setEncoding('utf8');
				response.on('data', (chunk: string) => {
					responseBody += chunk;
				});
				response.on('end', () => {
					try {
						resolve(JSON.parse(responseBody) as T);
					} catch (error) {
						reject(error);
					}
				});
			});

			request.on('error', (error) => reject(error));
		});
	}

	private async postJsonUpload(deviceIP: string, mac: string, jsonValue: string): Promise<void> {
		const response = await fetch(`http://${deviceIP}/jsonupload`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				mac,
				json: jsonValue,
			}),
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
	}

	private startTagDatabaseRefreshTimer(deviceIP: string): void {
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

	private clearTagDatabaseRefreshTimer(deviceIP: string): void {
		if (apConnection[deviceIP]?.tagRefreshTimer) {
			clearInterval(apConnection[deviceIP].tagRefreshTimer);
			delete apConnection[deviceIP].tagRefreshTimer;
		}
	}

}

if (require.main !== module) {
	// Export the constructor in compact mode
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new OpenEpaperLink(options);
} else {
	// otherwise start the instance directly
	(() => new OpenEpaperLink())();
}
