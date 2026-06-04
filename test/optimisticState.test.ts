import {PlatformAccessory} from 'homebridge/lib/platformAccessory';
import {DaikinCloudAccessoryContext, DaikinCloudPlatform} from '../src/platform';
import {MockPlatformConfig} from './mocks';
import {daikinAirConditioningAccessory} from '../src/daikinAirConditioningAccessory';
import {DaikinCloudDevice} from 'daikin-controller-cloud/dist/device';
import {OnectaClient} from 'daikin-controller-cloud/dist/onecta/oidc-client';
import {dx23Airco} from './fixtures/dx23-airco';

import {HomebridgeAPI} from 'homebridge/lib/api.js';
import {Logger} from 'homebridge/lib/logger.js';

function buildAccessory(requestResource: () => Promise<unknown>) {
    const device = new DaikinCloudDevice(structuredClone(dx23Airco), ({requestResource}) as unknown as OnectaClient);
    const config = new MockPlatformConfig(true);
    const api = new HomebridgeAPI();
    const uuid = api.hap.uuid.generate(device.getId());
    const accessory = new api.platformAccessory('NAME_FOR_TEST', uuid);
    accessory.context['device'] = device;
    return new daikinAirConditioningAccessory(new DaikinCloudPlatform(new Logger(), config, api), accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);
}

describe('Optimistic state and error propagation', () => {
    // The library does not refresh its local cache after a successful set, and the cloud only reflects the change
    // after the next poll. The service writes the new value into the cache optimistically so HomeKit stays consistent.
    test('a successful set is immediately reflected by the matching getter', async () => {
        const homebridgeAccessory = buildAccessory(async () => true);

        // dx23 fixture starts powered off
        expect(await homebridgeAccessory.service.handleActiveStateGet()).toBe(false);

        await homebridgeAccessory.service.handleActiveStateSet(1);

        // Without the optimistic cache update this would still read false until the next ~60s poll.
        expect(await homebridgeAccessory.service.handleActiveStateGet()).toBe(true);
    });

    // A failed cloud call must surface to HomeKit (so it shows "No Response" and reverts) rather than being swallowed.
    test('a failed set throws a HapStatusError', async () => {
        const homebridgeAccessory = buildAccessory(async () => {
            throw new Error('cloud unreachable');
        });

        let error: unknown;
        try {
            await homebridgeAccessory.service.handleActiveStateSet(1);
        } catch (e) {
            error = e;
        }
        expect((error as Error)?.constructor?.name).toBe('HapStatusError');

        // The optimistic cache update must NOT have happened on failure.
        expect(await homebridgeAccessory.service.handleActiveStateGet()).toBe(false);
    });
});
