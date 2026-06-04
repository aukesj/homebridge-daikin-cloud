import {PlatformAccessory} from 'homebridge/lib/platformAccessory';
import {DaikinCloudAccessoryContext, DaikinCloudPlatform} from '../src/platform';
import {MockPlatformConfig} from './mocks';
import {daikinAirConditioningAccessory} from '../src/daikinAirConditioningAccessory';
import {DaikinCloudDevice} from 'daikin-controller-cloud/dist/device';
import {OnectaClient} from 'daikin-controller-cloud/dist/onecta/oidc-client';
import {dx23Airco} from './fixtures/dx23-airco';

import {HomebridgeAPI} from 'homebridge/lib/api.js';
import {Logger} from 'homebridge/lib/logger.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

function buildAccessory() {
    // dx23 starts powered off.
    const device = new DaikinCloudDevice(structuredClone(dx23Airco), ({requestResource: async () => true}) as unknown as OnectaClient);
    const config = new MockPlatformConfig(true);
    const api = new HomebridgeAPI();
    const uuid = api.hap.uuid.generate(device.getId());
    const accessory = new api.platformAccessory('NAME_FOR_TEST', uuid);
    accessory.context['device'] = device;
    const homebridgeAccessory = new daikinAirConditioningAccessory(new DaikinCloudPlatform(new Logger(), config, api), accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);
    return {device, homebridgeAccessory};
}

// Simulates a poll that returns the (stale) original cloud state and emits 'updated', as the library does.
function simulatePollReturningOldState(device: DaikinCloudDevice) {
    device.setDescription(structuredClone(dx23Airco));
}

describe('Write-wins: the user choice is held against a laggy cloud', () => {
    test('a poll that still reports the old value does not revert the user choice', async () => {
        const {device, homebridgeAccessory} = buildAccessory();
        expect(await homebridgeAccessory.service.handleActiveStateGet()).toBe(false);

        // User turns it on.
        await homebridgeAccessory.service.handleActiveStateSet(1);
        expect(await homebridgeAccessory.service.handleActiveStateGet()).toBe(true);

        // The cloud is lagging: a poll still reports "off".
        simulatePollReturningOldState(device);
        await flush();

        // The plugin must keep showing the desired "on" and re-assert it, not revert to the stale "off".
        expect(await homebridgeAccessory.service.handleActiveStateGet()).toBe(true);
    });

    test('after enough failed re-assertions it gives up and accepts the cloud value', async () => {
        const {device, homebridgeAccessory} = buildAccessory();
        await homebridgeAccessory.service.handleActiveStateSet(1);

        // The cloud keeps reporting "off" on every poll. MAX_WRITE_ATTEMPTS is 3, so the 4th reconcile gives up.
        for (let i = 0; i < 4; i++) {
            simulatePollReturningOldState(device);
            await flush();
        }

        expect(await homebridgeAccessory.service.handleActiveStateGet()).toBe(false);
    });
});
