import {DaikinCloudRepo} from '../../src/repository/daikinCloudRepo';
import {dx4Airco} from '../fixtures/dx4-airco';
import {dx23Airco} from '../fixtures/dx23-airco';
import {althermaHeatPump} from '../fixtures/altherma-heat-pump';

test.each<Array<string | any>>([
    ['dx4', dx4Airco],
    ['dx23', dx23Airco],
    ['altherma', althermaHeatPump],
])('Clean cloud device data for %s device', (name, deviceJson) => {
    expect(DaikinCloudRepo.maskSensitiveCloudDeviceData(structuredClone(deviceJson))).toMatchSnapshot();
});

// Regression test for the "turning on one AC turns on all" bug: masking must NOT mutate the input, otherwise the live
// device cache gets its real serialNumber overwritten with 'REDACTED' for every device, giving them identical serials.
test('does not mutate the original device data', () => {
    const device = {
        id: 'device-1',
        managementPoints: [
            {embeddedId: 'gateway', serialNumber: {value: 'REAL-SERIAL-123'}, macAddress: {value: 'AA:BB:CC'}},
        ],
    };

    const masked = DaikinCloudRepo.maskSensitiveCloudDeviceData(device);

    // The masked copy is redacted...
    expect(masked.managementPoints[0].serialNumber.value).toBe('REDACTED');
    // ...but the original is untouched, so each accessory keeps its own real serial.
    expect(device.managementPoints[0].serialNumber.value).toBe('REAL-SERIAL-123');
});
