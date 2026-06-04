import {PlatformAccessory} from 'homebridge/lib/platformAccessory';
import {DaikinCloudAccessoryContext, DaikinCloudPlatform} from '../src/platform';
import {MockPlatformConfig} from './mocks';
import {daikinAirConditioningAccessory} from '../src/daikinAirConditioningAccessory';
import {DaikinCloudDevice} from 'daikin-controller-cloud/dist/device';
import {OnectaClient} from 'daikin-controller-cloud/dist/onecta/oidc-client';
import {dx23Airco} from './fixtures/dx23-airco';
import {dx23Airco2} from './fixtures/dx23-airco-2';

import {HomebridgeAPI} from 'homebridge/lib/api.js';
import {Logger} from 'homebridge/lib/logger.js';

function buildAccessory(deviceJson: object) {
    const device = new DaikinCloudDevice(structuredClone(deviceJson), ({requestResource: async () => true}) as unknown as OnectaClient);
    const config = new MockPlatformConfig(true);
    const api = new HomebridgeAPI();
    const uuid = api.hap.uuid.generate(device.getId());
    const accessory = new api.platformAccessory('NAME_FOR_TEST', uuid);
    accessory.context['device'] = device;

    new daikinAirConditioningAccessory(new DaikinCloudPlatform(new Logger(), config, api), accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);

    const serialNumber = accessory
        .getService(api.hap.Service.AccessoryInformation)!
        .getCharacteristic(api.hap.Characteristic.SerialNumber).value;

    return {device, serialNumber};
}

// Regression test for the "turning on one AC turns on all ACs" bug.
//
// Several air-to-air adapters (e.g. BRP069A8x/B4x) don't report a serialNumber. The plugin used to fall back to
// the constant string 'NOT_AVAILABLE', so every such accessory ended up with an identical SerialNumber. The Apple
// Home app then treats accessories with the same SerialNumber + Manufacturer as the same physical accessory and
// mirrors commands across them. The fix falls back to the (unique) device id instead.
describe('AccessoryInformation SerialNumber', () => {
    test('falls back to the unique device id when the device does not report a serialNumber', () => {
        const {device, serialNumber} = buildAccessory(dx23Airco);
        expect(serialNumber).toBe(device.getId());
        expect(serialNumber).not.toBe('NOT_AVAILABLE');
    });

    test('two devices without a serialNumber get distinct SerialNumbers', () => {
        const a = buildAccessory(dx23Airco);
        const b = buildAccessory(dx23Airco2);
        expect(a.serialNumber).not.toBe(b.serialNumber);
    });
});
