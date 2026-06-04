export class DaikinCloudRepo {
    static maskSensitiveCloudDeviceData(cloudDeviceDetails) {
        // IMPORTANT: deep-clone before masking. This used to mask in place, which mutated the live device cache:
        // serialNumber.value was overwritten with 'REDACTED' for every device just before its accessory was created
        // (called from createDevices). All accessories then got the identical SerialNumber 'REDACTED', which makes the
        // Apple Home app treat them as one physical accessory and mirror commands (turning on one AC turned on all).
        const masked = structuredClone(cloudDeviceDetails);

        masked.managementPoints = (masked.managementPoints ?? []).map(managementPoint => {
            if (managementPoint.ipAddress) managementPoint.ipAddress.value = 'REDACTED';
            if (managementPoint.macAddress) managementPoint.macAddress.value = 'REDACTED';
            if (managementPoint.ssid) managementPoint.ssid.value = 'REDACTED';
            if (managementPoint.serialNumber) managementPoint.serialNumber.value = 'REDACTED';
            if (managementPoint.wifiConnectionSSID) managementPoint.wifiConnectionSSID.value = 'REDACTED';
            if (managementPoint.consumptionData) managementPoint.consumptionData = 'REDACTED';
            if (managementPoint.schedule) managementPoint.schedule = 'REDACTED';

            return managementPoint;
        });

        return masked;
    }
}
