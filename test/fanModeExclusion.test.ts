import {PlatformAccessory} from 'homebridge/lib/platformAccessory';
import {DaikinCloudAccessoryContext, DaikinCloudPlatform} from '../src/platform';
import {MockPlatformConfig} from './mocks';
import {daikinAirConditioningAccessory} from '../src/daikinAirConditioningAccessory';
import {DaikinCloudDevice} from 'daikin-controller-cloud/dist/device';
import {OnectaClient} from 'daikin-controller-cloud/dist/onecta/oidc-client';
import {dx4Airco} from './fixtures/dx4-airco';

import {HomebridgeAPI} from 'homebridge/lib/api.js';
import {Logger} from 'homebridge/lib/logger.js';

function build() {
    const device = new DaikinCloudDevice(structuredClone(dx4Airco), ({requestResource: async () => true}) as unknown as OnectaClient);
    const config = new MockPlatformConfig(true); // showExtraFeatures -> Auto + Indoor silent switches exist
    const api = new HomebridgeAPI();
    const uuid = api.hap.uuid.generate(device.getId());
    const accessory = new api.platformAccessory('NAME_FOR_TEST', uuid);
    accessory.context['device'] = device;
    const hb = new daikinAirConditioningAccessory(new DaikinCloudPlatform(new Logger(), config, api), accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);
    return {accessory, api, service: hb.service};
}

// Auto fan and Indoor silent are the same underlying datapoint (one of auto/quiet/fixed), so only one can be active.
describe('Fan-mode switches are mutually exclusive', () => {
    test('enabling Auto turns Indoor silent off immediately', async () => {
        const {accessory, api, service} = build();
        const auto = accessory.getService('Auto fan speed')!;
        const silent = accessory.getService('Indoor silent mode')!;

        silent.updateCharacteristic(api.hap.Characteristic.On, true);
        await service.handleFanAutoModeSet(true);

        expect(silent.getCharacteristic(api.hap.Characteristic.On).value).toBe(false);
        expect(auto).toBeDefined();
    });

    test('enabling Indoor silent turns Auto off immediately', async () => {
        const {accessory, api, service} = build();
        const auto = accessory.getService('Auto fan speed')!;
        const silent = accessory.getService('Indoor silent mode')!;

        auto.updateCharacteristic(api.hap.Characteristic.On, true);
        await service.handleIndoorSilentModeSet(true);

        expect(auto.getCharacteristic(api.hap.Characteristic.On).value).toBe(false);
        expect(silent).toBeDefined();
    });
});
