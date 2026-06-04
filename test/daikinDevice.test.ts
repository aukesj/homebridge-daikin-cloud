import {PlatformAccessory} from 'homebridge/lib/platformAccessory';
import {DaikinCloudDevice} from 'daikin-controller-cloud/dist/device';
import {OnectaClient} from 'daikin-controller-cloud/dist/onecta/oidc-client';
import {dx4Airco} from './fixtures/dx4-airco';
import {althermaHeatPump} from './fixtures/altherma-heat-pump';

it('Get deviceModel from device %s', async () => {
    const accessory = new PlatformAccessory('NAME', 'efd08509-2edb-41d0-a9ab-ce913323d811');
    accessory.context.device = new DaikinCloudDevice(structuredClone(dx4Airco), ({requestResource: async () => true}) as unknown as OnectaClient);
    expect(accessory.context.device.getDescription().deviceModel).toEqual('dx4');
});

it('Get name from device %s', async () => {
    const accessory = new PlatformAccessory('NAME', 'efd08509-2edb-41d0-a9ab-ce913323d811');
    accessory.context.device = new DaikinCloudDevice(structuredClone(dx4Airco), ({requestResource: async () => true}) as unknown as OnectaClient);
    expect(accessory.context.device.getData('climateControl', 'name').value).toEqual('Zolder');
});

it('Get name from device %s', async () => {
    const accessory = new PlatformAccessory('NAME', 'efd08509-2edb-41d0-a9ab-ce913323d811');
    accessory.context.device = new DaikinCloudDevice(structuredClone(althermaHeatPump), ({requestResource: async () => true}) as unknown as OnectaClient);
    expect(accessory.context.device.getData('climateControlMainZone', 'name').value).toEqual('Altherma');
});

it('Get tankTemperature from device domesticHotWaterTank', async () => {
    const accessory = new PlatformAccessory('NAME', 'efd08509-2edb-41d0-a9ab-ce913323d811');
    accessory.context.device = new DaikinCloudDevice(structuredClone(althermaHeatPump), ({requestResource: async () => true}) as unknown as OnectaClient);
    expect(accessory.context.device.getData('domesticHotWaterTank', 'sensoryData', '/tankTemperature').value).toEqual(48);
});
