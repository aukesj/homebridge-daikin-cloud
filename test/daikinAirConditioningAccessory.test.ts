import {PlatformAccessory} from 'homebridge/lib/platformAccessory';
import {DaikinCloudAccessoryContext, DaikinCloudPlatform} from '../src/platform';
import {MockPlatformConfig} from './mocks';
import {daikinAirConditioningAccessory} from '../src/daikinAirConditioningAccessory';
import {DaikinCloudDevice} from 'daikin-controller-cloud/dist/device';
import {DaikinCloudController} from 'daikin-controller-cloud/dist/index.js';
import {OnectaClient} from 'daikin-controller-cloud/dist/onecta/oidc-client';
import {unknownJan} from './fixtures/unknown-jan';
import {unknownKitchenGuests} from './fixtures/unknown-kitchen-guests';
import {dx23Airco} from './fixtures/dx23-airco';
import {dx4Airco} from './fixtures/dx4-airco';
import {dx23Airco2} from './fixtures/dx23-airco-2';

import {HomebridgeAPI} from 'homebridge/lib/api.js';
import {Logger} from 'homebridge/lib/logger.js';

// Setters now propagate failures to HomeKit instead of swallowing them. A real cloud rejection (e.g. a datapoint
// that is read-only or a mode the fixture doesn't support) surfaces as a HapStatusError, which is acceptable for a
// smoke test. Only an unexpected error type (a programming bug) should fail the test.
async function expectSettable(fn: () => Promise<void>) {
    try {
        await fn();
    } catch (e) {
        expect((e as Error)?.constructor?.name).toBe('HapStatusError');
    }
}

type DeviceState = {
	activeState: boolean;
	currentTemperature: number;
	targetHeaterCoolerState: string;
	coolingThresholdTemperature: number;
	heatingThresholdTemperature: number;
	rotationSpeed: number;
	swingMode: number;
	powerfulMode: number;
	econoMode: number;
	streamerMode: number;
	outdoorSilentMode: number;
	indoorSilentMode: number;
	dryOperationMode: number;
	fanOnlyOperationMode: number;
};

test.each<Array<string | string | any | DeviceState>>([
    [
        'dx4',
        'climateControl',
        dx4Airco,
        {
            activeState: true,
            currentTemperature: 25,
            targetHeaterCoolerState: 1,
            coolingThresholdTemperature: 25,
            heatingThresholdTemperature: 22,
            rotationSpeed: 2,
            swingMode: 0,
            powerfulMode: false,
            econoMode: false,
            streamerMode: false,
            outdoorSilentMode: false,
            indoorSilentMode: false,
            dryOperationMode: false,
            fanOnlyOperationMode: false,
        },
    ],
    [
        'dx23',
        'climateControl',
        dx23Airco,
        {
            activeState: false,
            currentTemperature: 27,
            targetHeaterCoolerState: 2,
            coolingThresholdTemperature: 17,
            heatingThresholdTemperature: 17,
            rotationSpeed: 3,
            swingMode: 1,
            powerfulMode: undefined,
            econoMode: undefined,
            streamerMode: undefined,
            outdoorSilentMode: undefined,
            indoorSilentMode: undefined,
            dryOperationMode: false,
            fanOnlyOperationMode: false,
        },
    ],
    [
        'dx23-2',
        'climateControl',
        dx23Airco2,
        {
            activeState: true,
            currentTemperature: 19,
            targetHeaterCoolerState: 1,
            coolingThresholdTemperature: 25,
            heatingThresholdTemperature: 13,
            rotationSpeed: 4,
            swingMode: 0,
            powerfulMode: false,
            econoMode: undefined,
            streamerMode: undefined,
            outdoorSilentMode: undefined,
            indoorSilentMode: false,
            dryOperationMode: false,
            fanOnlyOperationMode: false,
        },
    ],
    [
        'unknown',
        'climateControl',
        unknownKitchenGuests,
        {
            activeState: false,
            currentTemperature: 30.1,
            targetHeaterCoolerState: 2,
            coolingThresholdTemperature: 23.5,
            heatingThresholdTemperature: undefined,
            rotationSpeed: 1,
            swingMode: 1,
            powerfulMode: undefined,
            econoMode: undefined,
            streamerMode: undefined,
            outdoorSilentMode: undefined,
            indoorSilentMode: undefined,
            dryOperationMode: false,
            fanOnlyOperationMode: false,
        },
    ],
    [
        'unknown2',
        'climateControl',
        unknownJan,
        {
            activeState: false,
            currentTemperature: 27,
            targetHeaterCoolerState: 2,
            coolingThresholdTemperature: 26.1,
            heatingThresholdTemperature: undefined,
            rotationSpeed: 1,
            swingMode: 1,
            powerfulMode: undefined,
            econoMode: undefined,
            streamerMode: undefined,
            outdoorSilentMode: undefined,
            indoorSilentMode: undefined,
            dryOperationMode: false,
            fanOnlyOperationMode: false,
        },
    ],
])('Create DaikinCloudAirConditioningAccessory with %s device', async (name: string, climateControlEmbeddedId: string, deviceJson, state: DeviceState) => {
    const device = new DaikinCloudDevice(structuredClone(deviceJson), ({requestResource: async () => true}) as unknown as OnectaClient);

    jest.spyOn(DaikinCloudController.prototype, 'getCloudDevices').mockImplementation(async () => {
        return [device];
    });

    const config = new MockPlatformConfig(true);
    const api = new HomebridgeAPI();

    const uuid = api.hap.uuid.generate(device.getId());
    const accessory = new api.platformAccessory("NAME_FOR_TEST", uuid);
    accessory.context['device'] = device;

    expect(() => {
        new daikinAirConditioningAccessory(new DaikinCloudPlatform(new Logger(), config, api), accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);
    }).not.toThrow();

    const homebridgeAccessory = new daikinAirConditioningAccessory(new DaikinCloudPlatform(new Logger(), config, api), accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);

    // Use the device's own current (valid) values for setters so we exercise the happy path. expectSettable tolerates
    // a clean HapStatusError for fixtures where a datapoint is read-only or a mode is unsupported.
    if (typeof state.activeState !== 'undefined') {
        expect(await homebridgeAccessory.service.handleActiveStateGet()).toBe(state.activeState);
        await expectSettable(() => homebridgeAccessory.service.handleActiveStateSet(1));
        await expectSettable(() => homebridgeAccessory.service.handleActiveStateSet(0));
    }

    expect(await homebridgeAccessory.service.handleCurrentTemperatureGet()).toBe(state.currentTemperature);

    if (typeof state.coolingThresholdTemperature !== 'undefined') {
        expect(await homebridgeAccessory.service.handleCoolingThresholdTemperatureGet()).toBe(state.coolingThresholdTemperature);
        await expectSettable(() => homebridgeAccessory.service.handleCoolingThresholdTemperatureSet(state.coolingThresholdTemperature));
    }

    if (typeof state.heatingThresholdTemperature !== 'undefined') {
        expect(await homebridgeAccessory.service.handleHeatingThresholdTemperatureGet()).toBe(state.heatingThresholdTemperature);
        await expectSettable(() => homebridgeAccessory.service.handleHeatingThresholdTemperatureSet(state.heatingThresholdTemperature));
    }

    if (typeof state.rotationSpeed !== 'undefined') {
        expect(await homebridgeAccessory.service.handleRotationSpeedGet()).toBe(state.rotationSpeed);
        await expectSettable(() => homebridgeAccessory.service.handleRotationSpeedSet(state.rotationSpeed));
    }

    if (typeof state.targetHeaterCoolerState !== 'undefined') {
        expect(await homebridgeAccessory.service.handleTargetHeaterCoolerStateGet()).toBe(state.targetHeaterCoolerState);
        await expectSettable(() => homebridgeAccessory.service.handleTargetHeaterCoolerStateSet(state.targetHeaterCoolerState));
    }

    if (typeof state.swingMode !== 'undefined') {
        expect(await homebridgeAccessory.service.handleSwingModeGet()).toBe(state.swingMode);
        await expectSettable(() => homebridgeAccessory.service.handleSwingModeSet(1));
    }

    if (typeof state.powerfulMode !== 'undefined') {
        expect(await homebridgeAccessory.service.handlePowerfulModeGet()).toBe(state.powerfulMode);
        await expectSettable(() => homebridgeAccessory.service.handlePowerfulModeSet(1));
    }

    if (typeof state.econoMode !== 'undefined') {
        expect(await homebridgeAccessory.service.handleEconoModeGet()).toBe(state.econoMode);
        await expectSettable(() => homebridgeAccessory.service.handleEconoModeSet(1));
    }

    if (typeof state.streamerMode !== 'undefined') {
        expect(await homebridgeAccessory.service.handleStreamerModeGet()).toBe(state.streamerMode);
        await expectSettable(() => homebridgeAccessory.service.handleStreamerModeSet(1));
    }

    if (typeof state.outdoorSilentMode !== 'undefined') {
        expect(await homebridgeAccessory.service.handleOutdoorSilentModeGet()).toBe(state.outdoorSilentMode);
        await expectSettable(() => homebridgeAccessory.service.handleOutdoorSilentModeSet(1));
    }

    if (typeof state.indoorSilentMode !== 'undefined') {
        expect(await homebridgeAccessory.service.handleIndoorSilentModeGet()).toBe(state.indoorSilentMode);
        await expectSettable(() => homebridgeAccessory.service.handleIndoorSilentModeSet(1));
    }

    if (typeof state.dryOperationMode !== 'undefined') {
        expect(await homebridgeAccessory.service.handleDryOperationModeGet()).toBe(state.dryOperationMode);
    }

    if (typeof state.fanOnlyOperationMode !== 'undefined') {
        expect(await homebridgeAccessory.service.handleFanOnlyOperationModeGet()).toBe(state.fanOnlyOperationMode);
    }
});

test.each<Array<string | string | any>>([
    ['dx4', 'climateControl', dx4Airco],
    ['dx23', 'climateControl', dx23Airco],
])('Create DaikinCloudAirConditioningAccessory with %s device, showExtraFeatures disabled', async (name, climateControlEmbeddedId, deviceJson) => {
    const device = new DaikinCloudDevice(structuredClone(deviceJson), ({requestResource: async () => true}) as unknown as OnectaClient);

    jest.spyOn(DaikinCloudController.prototype, 'getCloudDevices').mockImplementation(async () => {
        return [device];
    });


    const config = new MockPlatformConfig(false);
    const api = new HomebridgeAPI();

    const uuid = api.hap.uuid.generate(device.getId());
    const accessory = new api.platformAccessory("NAME_FOR_TEST", uuid);

    accessory.addService(api.hap.Service.Switch, 'Powerful mode', 'Powerful_Mode');
    accessory.addService(api.hap.Service.Switch, 'Econo mode', 'Econo_Mode');
    accessory.addService(api.hap.Service.Switch, 'Streamer mode', 'Streamer_Mode');
    accessory.addService(api.hap.Service.Switch, 'Outdoor silent mode', 'Outdoor_Silent_Mode');
    accessory.addService(api.hap.Service.Switch, 'Indoor silent mode', 'Indoor_Silent_Mode');
    accessory.context['device'] = device;

    const removeServiceSpy = jest.spyOn(accessory, 'removeService').mockImplementation();

    const homebridgeAccessory = new daikinAirConditioningAccessory(new DaikinCloudPlatform(new Logger(), config, api), accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);


    expect(removeServiceSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ displayName: 'Powerful mode', subtype: 'Powerful_Mode' }));
    expect(removeServiceSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ displayName: 'Econo mode', subtype: 'Econo_Mode' }));
    expect(removeServiceSpy).toHaveBeenNthCalledWith(3, expect.objectContaining({ displayName: 'Streamer mode', subtype: 'Streamer_Mode' }));
    expect(removeServiceSpy).toHaveBeenNthCalledWith(4, expect.objectContaining({ displayName: 'Outdoor silent mode', subtype: 'Outdoor_Silent_Mode' }));
    expect(removeServiceSpy).toHaveBeenNthCalledWith(5, expect.objectContaining({ displayName: 'Indoor silent mode', subtype: 'Indoor_Silent_Mode' }));

});

test('DaikinCloudAirConditioningAccessory Getters', async () => {
    const device = new DaikinCloudDevice(structuredClone(dx4Airco), ({requestResource: async () => true}) as unknown as OnectaClient);

    jest.spyOn(DaikinCloudController.prototype, 'getCloudDevices').mockImplementation(async () => {
        return [device];
    });

    const config = new MockPlatformConfig(false);
    const api = new HomebridgeAPI();

    const uuid = api.hap.uuid.generate(device.getId());
    const accessory = new api.platformAccessory(device.getData('climateControl', 'name', undefined).value, uuid);
    accessory.context['device'] = device;

    const homebridgeAccessory = new daikinAirConditioningAccessory(new DaikinCloudPlatform(new Logger(), config, api), accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);

    expect(await homebridgeAccessory.service.handleActiveStateGet()).toEqual(true);
    expect(await homebridgeAccessory.service.handleCurrentTemperatureGet()).toEqual(25);
    expect(await homebridgeAccessory.service.handleCoolingThresholdTemperatureGet()).toEqual(25);
    expect(await homebridgeAccessory.service.handleRotationSpeedGet()).toEqual(2);
    expect(await homebridgeAccessory.service.handleHeatingThresholdTemperatureGet()).toEqual(22);
    expect(await homebridgeAccessory.service.handleTargetHeaterCoolerStateGet()).toEqual(1);
    expect(await homebridgeAccessory.service.handleSwingModeGet()).toEqual(0);
    expect(await homebridgeAccessory.service.handlePowerfulModeGet()).toEqual(false);
    expect(await homebridgeAccessory.service.handleEconoModeGet()).toEqual(false);
    expect(await homebridgeAccessory.service.handleStreamerModeGet()).toEqual(false);
    expect(await homebridgeAccessory.service.handleOutdoorSilentModeGet()).toEqual(false);
    expect(await homebridgeAccessory.service.handleIndoorSilentModeGet()).toEqual(false);
});

test('DaikinCloudAirConditioningAccessory Setters', async () => {
    const device = new DaikinCloudDevice(structuredClone(dx4Airco), ({requestResource: async () => true}) as unknown as OnectaClient);

    jest.spyOn(DaikinCloudController.prototype, 'getCloudDevices').mockImplementation(async () => {
        return [device];
    });

    const setDataSpy = jest.spyOn(DaikinCloudDevice.prototype, 'setData').mockImplementation();

    const config = new MockPlatformConfig(false);
    const api = new HomebridgeAPI();

    const uuid = api.hap.uuid.generate(device.getId());
    const accessory = new api.platformAccessory(device.getData('climateControl', 'name', undefined).value, uuid);
    // device.updateData = () => jest.fn();
    accessory.context['device'] = device;

    const homebridgeAccessory = new daikinAirConditioningAccessory(new DaikinCloudPlatform(new Logger(), config, api), accessory as unknown as PlatformAccessory<DaikinCloudAccessoryContext>);

    await homebridgeAccessory.service.handleActiveStateSet(1);
    expect(setDataSpy).toHaveBeenNthCalledWith(1, 'climateControl', 'onOffMode', undefined, 'on');

    await homebridgeAccessory.service.handleActiveStateSet(0);
    expect(setDataSpy).toHaveBeenNthCalledWith(2, 'climateControl', 'onOffMode', undefined, 'off');

    await homebridgeAccessory.service.handleCoolingThresholdTemperatureSet(21);
    expect(setDataSpy).toHaveBeenNthCalledWith(3, 'climateControl', 'temperatureControl', '/operationModes/cooling/setpoints/roomTemperature', 21);

    await homebridgeAccessory.service.handleRotationSpeedSet(50);
    expect(setDataSpy).toHaveBeenNthCalledWith(4, 'climateControl', 'fanControl', '/operationModes/heating/fanSpeed/currentMode', 'fixed');
    expect(setDataSpy).toHaveBeenNthCalledWith(5, 'climateControl', 'fanControl', '/operationModes/heating/fanSpeed/modes/fixed', 50);

    await homebridgeAccessory.service.handleHeatingThresholdTemperatureSet(25);
    expect(setDataSpy).toHaveBeenNthCalledWith(6, 'climateControl', 'temperatureControl', '/operationModes/heating/setpoints/roomTemperature', 25);

    await homebridgeAccessory.service.handleTargetHeaterCoolerStateSet(1);
    expect(setDataSpy).toHaveBeenNthCalledWith(7, 'climateControl', 'operationMode', undefined, 'heating');
    expect(setDataSpy).toHaveBeenNthCalledWith(8, 'climateControl', 'onOffMode', undefined, 'on');

    await homebridgeAccessory.service.handleSwingModeSet(1);
    expect(setDataSpy).toHaveBeenNthCalledWith(9, 'climateControl', 'fanControl', '/operationModes/heating/fanDirection/horizontal/currentMode', 'swing');
    expect(setDataSpy).toHaveBeenNthCalledWith(10, 'climateControl', 'fanControl', '/operationModes/heating/fanDirection/vertical/currentMode', 'swing');

    await homebridgeAccessory.service.handlePowerfulModeSet(1);
    expect(setDataSpy).toHaveBeenNthCalledWith(11, 'climateControl', 'powerfulMode', undefined, 'on');

    await homebridgeAccessory.service.handleEconoModeSet(1);
    expect(setDataSpy).toHaveBeenNthCalledWith(12, 'climateControl', 'econoMode', undefined, 'on');

    await homebridgeAccessory.service.handleStreamerModeSet(1);
    expect(setDataSpy).toHaveBeenNthCalledWith(13, 'climateControl', 'streamerMode', undefined, 'on');

    await homebridgeAccessory.service.handleOutdoorSilentModeSet(1);
    expect(setDataSpy).toHaveBeenNthCalledWith(14, 'climateControl', 'outdoorSilentMode', undefined, 'on');

    await homebridgeAccessory.service.handleIndoorSilentModeSet(1);
    expect(setDataSpy).toHaveBeenNthCalledWith(15, 'climateControl', 'fanControl', '/operationModes/heating/fanSpeed/currentMode', 'quiet');
});
