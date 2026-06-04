import {PlatformAccessory} from 'homebridge/lib/platformAccessory';
import {DaikinCloudAccessoryContext, DaikinCloudPlatform} from '../src/platform';
import {MockPlatformConfig} from './mocks';
import {daikinAirConditioningAccessory} from '../src/daikinAirConditioningAccessory';
import {DaikinCloudDevice} from 'daikin-controller-cloud/dist/device';
import {OnectaClient} from 'daikin-controller-cloud/dist/onecta/oidc-client';
import {dx4Airco} from './fixtures/dx4-airco';
import {dx23Airco} from './fixtures/dx23-airco';

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
    return {accessory, api};
}

describe('Extra sensors', () => {
    test('dx4 exposes an outdoor temperature sensor with the reported value', () => {
        const {accessory, api} = buildAccessory(dx4Airco);
        const service = accessory.getService('Outdoor temperature');
        expect(service).toBeDefined();
        expect(service!.getCharacteristic(api.hap.Characteristic.CurrentTemperature).value).toBe(25.5);
    });

    test('dx23 has no outdoor temperature sensor (not reported by that adapter)', () => {
        const {accessory} = buildAccessory(dx23Airco);
        expect(accessory.getService('Outdoor temperature')).toBeUndefined();
    });

    test('exposes a fault contact sensor that reads "no fault" when healthy', () => {
        const {accessory, api} = buildAccessory(dx4Airco);
        const service = accessory.getService('Fault');
        expect(service).toBeDefined();
        // Fixture reports isInErrorState=false -> CONTACT_DETECTED (0) == no fault.
        expect(service!.getCharacteristic(api.hap.Characteristic.ContactSensorState).value)
            .toBe(api.hap.Characteristic.ContactSensorState.CONTACT_DETECTED);
    });
});
