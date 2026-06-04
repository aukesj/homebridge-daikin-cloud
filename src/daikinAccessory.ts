import {PlatformAccessory} from 'homebridge';
import {DaikinCloudAccessoryContext, DaikinCloudPlatform} from './platform';

export class daikinAccessory {
    readonly platform: DaikinCloudPlatform;
    readonly accessory: PlatformAccessory<DaikinCloudAccessoryContext>;
    public readonly gatewayManagementPointId: string | null;
    constructor(
        platform: DaikinCloudPlatform,
        accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
    ) {
        this.platform = platform;
        this.accessory = accessory;
        this.gatewayManagementPointId = this.getEmbeddedIdByManagementPointType('gateway');

        this.printDeviceInfo();

        const serialNumberData = accessory.context.device.getData(this.gatewayManagementPointId, 'serialNumber', undefined);
        // Some adapters (e.g. BRP069A8x/B4x air-to-air units) don't report a serialNumber. Falling back to a
        // constant string would give every such accessory an identical SerialNumber, which makes the Apple Home
        // app treat them as the same physical accessory and mirror commands across them (e.g. turning on one AC
        // turns on all of them). The device id is unique per gateway-device, so use it as a stable unique fallback.
        const serialNumber: string = serialNumberData ? serialNumberData.value : accessory.context.device.getId();

        const firmwareData = accessory.context.device.getData(this.gatewayManagementPointId, 'firmwareVersion', undefined);

        const accessoryInformation = this.accessory.getService(this.platform.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Daikin')
            .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.getData(this.gatewayManagementPointId, 'modelInfo', undefined).value)
            .setCharacteristic(this.platform.Characteristic.SerialNumber, serialNumber);

        if (firmwareData) {
            accessoryInformation.setCharacteristic(this.platform.Characteristic.FirmwareRevision, firmwareData.value);
        }

        this.accessory.context.device.on('updated', () => {
            this.platform.log.debug(`[API Syncing] Updated ${this.accessory.displayName} (${this.accessory.UUID}), LastUpdated: ${this.accessory.context.device.getLastUpdated()}`);
        });
    }

    printDeviceInfo() {
        this.platform.log.info('[Platform] Device found with id: ' + this.accessory.UUID);
        this.platform.log.info('[Platform]     id: ' + this.accessory.UUID);
        this.platform.log.info('[Platform]     name: ' + this.accessory.displayName);
        this.platform.log.info('[Platform]     last updated: ' + this.accessory.context.device.getLastUpdated());
        this.platform.log.info('[Platform]     modelInfo: ' + this.accessory.context.device.getData(this.gatewayManagementPointId, 'modelInfo', undefined).value);
        this.platform.log.info('[Platform]     deviceModel: ' + this.accessory.context.device.getDescription().deviceModel);
    }

    getEmbeddedIdByManagementPointType(managementPointType: string): string | null {
        const managementPoints = this.accessory.context.device.desc.managementPoints.filter((managementPoint) => (managementPoint).managementPointType === managementPointType);

        if (managementPoints.length === 0) {
            this.platform.log.error(`[Platform] No management point found for managementPointType ${managementPointType}`);
            return null;
        }

        if (managementPoints.length >= 2) {
            this.platform.log.warn(`[Platform] Found more then one management point for managementPointType ${managementPointType}, we don't expect this, please open an issue on https://github.com/JeroenVdb/homebridge-daikin-cloud/issues`);
            return null;
        }

        return managementPoints[0].embeddedId;
    }
}
