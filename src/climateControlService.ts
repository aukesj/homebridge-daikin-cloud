import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';
import {DaikinCloudAccessoryContext, DaikinCloudPlatform} from './platform';
import {DaikinCloudRepo} from './repository/daikinCloudRepo';

export class ClimateControlService {
    readonly platform: DaikinCloudPlatform;
    readonly accessory: PlatformAccessory<DaikinCloudAccessoryContext>;
    readonly managementPointId: string;

    private extraServices = {
        POWERFUL_MODE: 'Powerful mode',
        ECONO_MODE: 'Econo mode',
        STREAMER_MODE: 'Streamer mode',
        OUTDOUR_SILENT_MODE: 'Outdoor silent mode',
        INDOOR_SILENT_MODE: 'Indoor silent mode',
        FAN_AUTO_MODE: 'Auto fan speed',
        DRY_OPERATION_MODE: 'Dry operation mode',
        FAN_ONLY_OPERATION_MODE: 'Fan only operation mode',
    };

    private readonly name: string;
    private readonly outdoorTemperatureSensorName = 'Outdoor temperature';
    private readonly faultSensorName = 'Fault';

    // Values the user asked for that the cloud has not confirmed yet. The cloud is laggy and can drop updates, so on
    // every poll we re-assert these and keep HomeKit showing the desired value, instead of letting a stale cloud read
    // revert the user's choice. Keyed by `${dataPoint}:${dataPointPath ?? ''}`.
    private readonly pendingWrites = new Map<string, { dataPoint: string; dataPointPath: string | undefined; value: string | number; attempts: number }>();
    private static readonly MAX_WRITE_ATTEMPTS = 3;

    private readonly service?: Service;
    private readonly switchServicePowerfulMode?: Service;
    private readonly switchServiceEconoMode?: Service;
    private readonly switchServiceStreamerMode?: Service;
    private readonly switchServiceOutdoorSilentMode?: Service;
    private readonly switchServiceIndoorSilentMode?: Service;
    private readonly switchServiceFanAutoMode?: Service;
    private readonly switchServiceDryOperationMode?: Service;
    private readonly switchServiceFanOnlyOperationMode?: Service;
    private readonly outdoorTemperatureSensorService?: Service;
    private readonly faultContactSensorService?: Service;

    constructor(
        platform: DaikinCloudPlatform,
        accessory: PlatformAccessory<DaikinCloudAccessoryContext>,
        managementPointId: string,
    ) {
        this.platform = platform;
        this.accessory = accessory;
        this.managementPointId = managementPointId;

        this.service = this.accessory.getService(this.platform.Service.HeaterCooler);
        this.switchServicePowerfulMode = this.accessory.getService(this.extraServices.POWERFUL_MODE);
        this.switchServiceEconoMode = this.accessory.getService(this.extraServices.ECONO_MODE);
        this.switchServiceStreamerMode = this.accessory.getService(this.extraServices.STREAMER_MODE);
        this.switchServiceOutdoorSilentMode = this.accessory.getService(this.extraServices.OUTDOUR_SILENT_MODE);
        this.switchServiceIndoorSilentMode = this.accessory.getService(this.extraServices.INDOOR_SILENT_MODE);
        this.switchServiceFanAutoMode = this.accessory.getService(this.extraServices.FAN_AUTO_MODE);
        this.switchServiceDryOperationMode = this.accessory.getService(this.extraServices.DRY_OPERATION_MODE);
        this.switchServiceFanOnlyOperationMode = this.accessory.getService(this.extraServices.FAN_ONLY_OPERATION_MODE);

        this.name = this.accessory.displayName;

        this.service = this.service || this.accessory.addService(this.platform.Service.HeaterCooler);

        this.service.setCharacteristic(this.platform.Characteristic.Name, this.name);

        // Required characteristic
        this.service.getCharacteristic(this.platform.Characteristic.Active)
            .onSet(this.handleActiveStateSet.bind(this))
            .onGet(this.handleActiveStateGet.bind(this));

        // Required characteristic
        this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
            .onGet(this.handleCurrentTemperatureGet.bind(this));

        // Required characteristic
        this.service.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
            .setProps({
                minStep: 1,
                minValue: 0,
                maxValue: 2,
            })
            .onGet(this.handleTargetHeaterCoolerStateGet.bind(this))
            .onSet(this.handleTargetHeaterCoolerStateSet.bind(this));

        const roomTemperatureControlForCooling = accessory.context.device.getData(this.managementPointId, 'temperatureControl', `/operationModes/${DaikinOperationModes.COOLING}/setpoints/${this.getSetpoint(DaikinOperationModes.COOLING)}`);
        if (roomTemperatureControlForCooling) {
            this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
                .setProps({
                    minStep: roomTemperatureControlForCooling.stepValue,
                    minValue: roomTemperatureControlForCooling.minValue,
                    maxValue: roomTemperatureControlForCooling.maxValue,
                })
                .onGet(this.handleCoolingThresholdTemperatureGet.bind(this))
                .onSet(this.handleCoolingThresholdTemperatureSet.bind(this));

        } else {
            this.service.removeCharacteristic(this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature));
        }

        const roomTemperatureControlForHeating = accessory.context.device.getData(this.managementPointId, 'temperatureControl', `/operationModes/${DaikinOperationModes.HEATING}/setpoints/${this.getSetpoint(DaikinOperationModes.HEATING)}`);
        if (roomTemperatureControlForHeating) {
            this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
                .setProps({
                    minStep: roomTemperatureControlForHeating.stepValue,
                    minValue: roomTemperatureControlForHeating.minValue,
                    maxValue: roomTemperatureControlForHeating.maxValue,
                })
                .onGet(this.handleHeatingThresholdTemperatureGet.bind(this))
                .onSet(this.handleHeatingThresholdTemperatureSet.bind(this));
        } else {
            this.service.removeCharacteristic(this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature));
        }

        this.addOrUpdateCharacteristicRotationSpeed();

        if (this.hasSwingModeFeature()) {
            this.platform.log.debug(`[${this.name}] Device has SwingMode, add Characteristic`);
            this.service.getCharacteristic(this.platform.Characteristic.SwingMode)
                .onGet(this.handleSwingModeGet.bind(this))
                .onSet(this.handleSwingModeSet.bind(this));
        }

        if (this.hasPowerfulModeFeature() && this.platform.config.showExtraFeatures) {
            this.platform.log.debug(`[${this.name}] Device has PowerfulMode, add Switch Service`);

            this.switchServicePowerfulMode = this.switchServicePowerfulMode || accessory.addService(this.platform.Service.Switch, this.extraServices.POWERFUL_MODE, 'powerful_mode');
            this.switchServicePowerfulMode.setCharacteristic(this.platform.Characteristic.Name, this.extraServices.POWERFUL_MODE);

            this.switchServicePowerfulMode
                .addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
            this.switchServicePowerfulMode
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, this.extraServices.POWERFUL_MODE);

            this.switchServicePowerfulMode.getCharacteristic(this.platform.Characteristic.On)
                .onGet(this.handlePowerfulModeGet.bind(this))
                .onSet(this.handlePowerfulModeSet.bind(this));

        } else {
            if (this.switchServicePowerfulMode) {
                accessory.removeService(this.switchServicePowerfulMode);
            }
        }

        if (this.hasEconoModeFeature() && this.platform.config.showExtraFeatures) {
            this.platform.log.debug(`[${this.name}] Device has EconoMode, add Switch Service`);

            this.switchServiceEconoMode = this.switchServiceEconoMode || accessory.addService(this.platform.Service.Switch, this.extraServices.ECONO_MODE, 'econo_mode');
            this.switchServiceEconoMode.setCharacteristic(this.platform.Characteristic.Name, this.extraServices.ECONO_MODE);

            this.switchServiceEconoMode
                .addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
            this.switchServiceEconoMode
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, this.extraServices.ECONO_MODE);

            this.switchServiceEconoMode.getCharacteristic(this.platform.Characteristic.On)
                .onGet(this.handleEconoModeGet.bind(this))
                .onSet(this.handleEconoModeSet.bind(this));
        } else {
            if (this.switchServiceEconoMode) {
                accessory.removeService(this.switchServiceEconoMode);
            }
        }

        if (this.hasStreamerModeFeature() && this.platform.config.showExtraFeatures) {
            this.platform.log.debug(`[${this.name}] Device has StreamerMode, add Switch Service`);

            this.switchServiceStreamerMode = this.switchServiceStreamerMode || accessory.addService(this.platform.Service.Switch, this.extraServices.STREAMER_MODE, 'streamer_mode');
            this.switchServiceStreamerMode.setCharacteristic(this.platform.Characteristic.Name, this.extraServices.STREAMER_MODE);

            this.switchServiceStreamerMode
                .addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
            this.switchServiceStreamerMode
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, this.extraServices.STREAMER_MODE);

            this.switchServiceStreamerMode.getCharacteristic(this.platform.Characteristic.On)
                .onGet(this.handleStreamerModeGet.bind(this))
                .onSet(this.handleStreamerModeSet.bind(this));

        } else {
            if (this.switchServiceStreamerMode) {
                accessory.removeService(this.switchServiceStreamerMode);
            }
        }

        if (this.hasOutdoorSilentModeFeature() && this.platform.config.showExtraFeatures) {
            this.platform.log.debug(`[${this.name}] Device has StreamerMode, add Switch Service`);

            this.switchServiceOutdoorSilentMode = this.switchServiceOutdoorSilentMode || accessory.addService(this.platform.Service.Switch, this.extraServices.OUTDOUR_SILENT_MODE, 'outdoor_silent_mode');
            this.switchServiceOutdoorSilentMode.setCharacteristic(this.platform.Characteristic.Name, this.extraServices.OUTDOUR_SILENT_MODE);

            this.switchServiceOutdoorSilentMode
                .addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
            this.switchServiceOutdoorSilentMode
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, this.extraServices.OUTDOUR_SILENT_MODE);

            this.switchServiceOutdoorSilentMode.getCharacteristic(this.platform.Characteristic.On)
                .onGet(this.handleOutdoorSilentModeGet.bind(this))
                .onSet(this.handleOutdoorSilentModeSet.bind(this));
        } else {
            if (this.switchServiceOutdoorSilentMode) {
                accessory.removeService(this.switchServiceOutdoorSilentMode);
            }
        }

        if (this.hasIndoorSilentModeFeature() && this.platform.config.showExtraFeatures) {
            this.platform.log.debug(`[${this.name}] Device has IndoorSilentMode, add Switch Service`);

            this.switchServiceIndoorSilentMode = this.switchServiceIndoorSilentMode || accessory.addService(this.platform.Service.Switch, this.extraServices.INDOOR_SILENT_MODE, 'indoor_silent_mode');
            this.switchServiceIndoorSilentMode.setCharacteristic(this.platform.Characteristic.Name, this.extraServices.INDOOR_SILENT_MODE);

            this.switchServiceIndoorSilentMode
                .addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
            this.switchServiceIndoorSilentMode
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, this.extraServices.INDOOR_SILENT_MODE);

            this.switchServiceIndoorSilentMode.getCharacteristic(this.platform.Characteristic.On)
                .onGet(this.handleIndoorSilentModeGet.bind(this))
                .onSet(this.handleIndoorSilentModeSet.bind(this));
        } else {
            if (this.switchServiceIndoorSilentMode) {
                accessory.removeService(this.switchServiceIndoorSilentMode);
            }
        }

        if (this.hasFanAutoModeFeature() && this.platform.config.showExtraFeatures) {
            this.platform.log.debug(`[${this.name}] Device has FanAutoMode, add Switch Service`);

            this.switchServiceFanAutoMode = this.switchServiceFanAutoMode || accessory.addService(this.platform.Service.Switch, this.extraServices.FAN_AUTO_MODE, 'fan_auto_mode');
            this.switchServiceFanAutoMode.setCharacteristic(this.platform.Characteristic.Name, this.extraServices.FAN_AUTO_MODE);

            this.switchServiceFanAutoMode
                .addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
            this.switchServiceFanAutoMode
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, this.extraServices.FAN_AUTO_MODE);

            this.switchServiceFanAutoMode.getCharacteristic(this.platform.Characteristic.On)
                .onGet(this.handleFanAutoModeGet.bind(this))
                .onSet(this.handleFanAutoModeSet.bind(this));
        } else {
            if (this.switchServiceFanAutoMode) {
                accessory.removeService(this.switchServiceFanAutoMode);
            }
        }

        if (this.hasDryOperationModeFeature() && this.platform.config.showExtraFeatures) {
            this.platform.log.debug(`[${this.name}] Device has DryOperationMode, add Switch Service`);

            this.switchServiceDryOperationMode = this.switchServiceDryOperationMode || accessory.addService(this.platform.Service.Switch, this.extraServices.DRY_OPERATION_MODE, 'dry_operation_mode');
            this.switchServiceDryOperationMode.setCharacteristic(this.platform.Characteristic.Name, this.extraServices.DRY_OPERATION_MODE);

            this.switchServiceDryOperationMode
                .addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
            this.switchServiceDryOperationMode
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, this.extraServices.DRY_OPERATION_MODE);

            this.switchServiceDryOperationMode.getCharacteristic(this.platform.Characteristic.On)
                .onGet(this.handleDryOperationModeGet.bind(this))
                .onSet(this.handleDryOperationModeSet.bind(this));
        } else {
            if (this.switchServiceDryOperationMode) {
                accessory.removeService(this.switchServiceDryOperationMode);
            }
        }

        if (this.hasFanOnlyOperationModeFeature() && this.platform.config.showExtraFeatures) {
            this.platform.log.debug(`[${this.name}] Device has FanOnlyOperationMode, add Switch Service`);

            this.switchServiceFanOnlyOperationMode = this.switchServiceFanOnlyOperationMode || accessory.addService(this.platform.Service.Switch, this.extraServices.FAN_ONLY_OPERATION_MODE, 'fan_only_operation_mode');
            this.switchServiceFanOnlyOperationMode.setCharacteristic(this.platform.Characteristic.Name, this.extraServices.FAN_ONLY_OPERATION_MODE);

            this.switchServiceFanOnlyOperationMode
                .addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName);
            this.switchServiceFanOnlyOperationMode
                .setCharacteristic(this.platform.Characteristic.ConfiguredName, this.extraServices.FAN_ONLY_OPERATION_MODE);

            this.switchServiceFanOnlyOperationMode.getCharacteristic(this.platform.Characteristic.On)
                .onGet(this.handleFanOnlyOperationModeGet.bind(this))
                .onSet(this.handleFanOnlyOperationModeSet.bind(this));
        } else {
            if (this.switchServiceFanOnlyOperationMode) {
                accessory.removeService(this.switchServiceFanOnlyOperationMode);
            }
        }

        // Outdoor temperature sensor: the Onecta app shows it but HomeKit's HeaterCooler can't, so expose it as a
        // separate TemperatureSensor. Only some adapters report it, so add it conditionally.
        // Off by default: a TemperatureSensor in the same accessory makes the Apple Home app show the outdoor reading
        // on the climate tile, which looks like the AC is working off the outside temperature. Opt in with config.
        const outdoorTemperature = accessory.context.device.getData(this.managementPointId, 'sensoryData', '/outdoorTemperature');
        this.outdoorTemperatureSensorService = this.accessory.getService(this.outdoorTemperatureSensorName);
        if (outdoorTemperature && this.platform.config.showOutdoorTemperatureSensor) {
            this.outdoorTemperatureSensorService = this.outdoorTemperatureSensorService || accessory.addService(this.platform.Service.TemperatureSensor, this.outdoorTemperatureSensorName, 'outdoor_temperature');
            this.outdoorTemperatureSensorService.setCharacteristic(this.platform.Characteristic.Name, this.outdoorTemperatureSensorName);
            this.outdoorTemperatureSensorService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
                .onGet(this.handleOutdoorTemperatureGet.bind(this))
                .updateValue(outdoorTemperature.value);
        } else if (this.outdoorTemperatureSensorService) {
            accessory.removeService(this.outdoorTemperatureSensorService);
        }

        // Fault sensor: exposed as a ContactSensor ("open" == fault) so the user can switch on notifications for it in
        // the Home app and get pushed when a unit reports an error, without opening the Onecta app.
        const isInErrorState = accessory.context.device.getData(this.managementPointId, 'isInErrorState', undefined);
        this.faultContactSensorService = this.accessory.getService(this.faultSensorName);
        if (isInErrorState) {
            this.faultContactSensorService = this.faultContactSensorService || accessory.addService(this.platform.Service.ContactSensor, this.faultSensorName, 'fault');
            this.faultContactSensorService.setCharacteristic(this.platform.Characteristic.Name, this.faultSensorName);
            this.faultContactSensorService.getCharacteristic(this.platform.Characteristic.ContactSensorState)
                .onGet(this.handleFaultGet.bind(this))
                .updateValue(isInErrorState.value
                    ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
                    : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED);
        } else if (this.faultContactSensorService) {
            accessory.removeService(this.faultContactSensorService);
        }

        // After every poll the library overwrites its cache with the cloud state and emits 'updated'. We use that to
        // (a) re-assert any unconfirmed user writes and (b) proactively push the fresh state to HomeKit, so changes
        // made outside Home (e.g. in the Onecta app) show up without the user having to open the Home app.
        this.accessory.context.device.on('updated', () => {
            this.reconcileAndSync().catch((e) => this.platform.log.error(`[${this.name}] Failed to sync after update`, e));
        });
    }

    addOrUpdateCharacteristicRotationSpeed() {
        if (!this.service) {
            throw Error('Service not initialized');
        }

        const fanControl = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/modes/fixed`);

        if (fanControl) {
            this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
                .setProps({
                    minStep: fanControl.stepValue,
                    minValue: fanControl.minValue,
                    maxValue: fanControl.maxValue,
                })
                .onGet(this.handleRotationSpeedGet.bind(this))
                .onSet(this.handleRotationSpeedSet.bind(this));
        } else {
            this.service.removeCharacteristic(this.service.getCharacteristic(this.platform.Characteristic.RotationSpeed));
        }
    }

    /**
     * Send a value to the Daikin cloud and keep HomeKit consistent.
     *
     * The underlying daikin-controller-cloud library does NOT update its local cache after a successful PATCH, and
     * the cloud only reflects the change after a poll (forceUpdateDelay, default 60s). Without compensation a quick
     * onGet from HomeKit reads the stale value and the control "bounces back". So on success we optimistically write
     * the new value into the cached datapoint, so subsequent onGets return it until the next poll confirms it.
     *
     * On failure we log and throw a HapStatusError, so HomeKit surfaces the failure ("No Response") and reverts the
     * control, instead of the old behaviour of silently swallowing the error and pretending it worked.
     */
    private async setData(dataPoint: string, dataPointPath: string | undefined, value: string | number) {
        const cachedDatapoint = this.accessory.context.device.getData(this.managementPointId, dataPoint, dataPointPath);
        try {
            await this.accessory.context.device.setData(this.managementPointId, dataPoint, dataPointPath as string, value);
        } catch (e) {
            this.platform.log.error(`[${this.name}] Failed to set ${dataPoint}${dataPointPath ? ' ' + dataPointPath : ''} to ${value}`, e, JSON.stringify(DaikinCloudRepo.maskSensitiveCloudDeviceData(this.accessory.context.device.desc), null, 4));
            throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
        if (cachedDatapoint) {
            cachedDatapoint.value = value;
        }
        // Remember the desired value so a later poll that still reads the old cloud state doesn't revert it.
        this.pendingWrites.set(`${dataPoint}:${dataPointPath ?? ''}`, {dataPoint, dataPointPath, value, attempts: 0});
        this.platform.forceUpdateDevices();
    }

    /**
     * Runs on every poll ('updated' event). Re-asserts unconfirmed user writes (write-wins) and pushes the current
     * state to HomeKit so external changes become visible.
     */
    private async reconcileAndSync() {
        const device = this.accessory.context.device;

        for (const [key, pending] of this.pendingWrites) {
            const cached = device.getData(this.managementPointId, pending.dataPoint, pending.dataPointPath);
            const cloudValue = cached?.value;

            if (cloudValue === pending.value) {
                this.platform.log.debug(`[${this.name}] Cloud confirmed ${key} = ${pending.value}`);
                this.pendingWrites.delete(key);
                continue;
            }

            if (pending.attempts >= ClimateControlService.MAX_WRITE_ATTEMPTS) {
                this.platform.log.warn(`[${this.name}] Giving up on ${key} = ${pending.value} after ${pending.attempts} attempts, accepting cloud value ${cloudValue}`);
                this.pendingWrites.delete(key);
                continue;
            }

            pending.attempts++;
            if (cached) {
                cached.value = pending.value; // keep HomeKit showing the desired value
            }
            this.platform.log.debug(`[${this.name}] Re-asserting ${key} = ${pending.value} (attempt ${pending.attempts})`);
            try {
                await device.setData(this.managementPointId, pending.dataPoint, pending.dataPointPath as string, pending.value);
            } catch (e) {
                this.platform.log.error(`[${this.name}] Failed to re-assert ${key} = ${pending.value}`, e);
            }
        }

        if (this.pendingWrites.size > 0) {
            this.platform.forceUpdateDevices(); // schedule another poll to verify the re-asserted writes
        }

        await this.syncToHomeKit();
    }

    /**
     * Push the current cached state to HomeKit. Each push is guarded so a missing datapoint just skips that
     * characteristic instead of breaking the whole sync.
     */
    private async syncToHomeKit() {
        if (!this.service) {
            return;
        }
        const C = this.platform.Characteristic;

        await this.push(this.service, C.Active, () => this.handleActiveStateGet());
        await this.push(this.service, C.CurrentTemperature, () => this.handleCurrentTemperatureGet());
        await this.push(this.service, C.TargetHeaterCoolerState, () => this.handleTargetHeaterCoolerStateGet());
        if (this.service.testCharacteristic(C.CoolingThresholdTemperature)) {
            await this.push(this.service, C.CoolingThresholdTemperature, () => this.handleCoolingThresholdTemperatureGet());
        }
        if (this.service.testCharacteristic(C.HeatingThresholdTemperature)) {
            await this.push(this.service, C.HeatingThresholdTemperature, () => this.handleHeatingThresholdTemperatureGet());
        }
        if (this.service.testCharacteristic(C.RotationSpeed)) {
            await this.push(this.service, C.RotationSpeed, () => this.handleRotationSpeedGet());
        }
        if (this.hasSwingModeFeature()) {
            await this.push(this.service, C.SwingMode, () => this.handleSwingModeGet());
        }

        if (this.switchServicePowerfulMode) {
            await this.push(this.switchServicePowerfulMode, C.On, () => this.handlePowerfulModeGet());
        }
        if (this.switchServiceEconoMode) {
            await this.push(this.switchServiceEconoMode, C.On, () => this.handleEconoModeGet());
        }
        if (this.switchServiceStreamerMode) {
            await this.push(this.switchServiceStreamerMode, C.On, () => this.handleStreamerModeGet());
        }
        if (this.switchServiceOutdoorSilentMode) {
            await this.push(this.switchServiceOutdoorSilentMode, C.On, () => this.handleOutdoorSilentModeGet());
        }
        if (this.switchServiceIndoorSilentMode) {
            await this.push(this.switchServiceIndoorSilentMode, C.On, () => this.handleIndoorSilentModeGet());
        }
        if (this.switchServiceFanAutoMode) {
            await this.push(this.switchServiceFanAutoMode, C.On, () => this.handleFanAutoModeGet());
        }
        if (this.switchServiceDryOperationMode) {
            await this.push(this.switchServiceDryOperationMode, C.On, () => this.handleDryOperationModeGet());
        }
        if (this.switchServiceFanOnlyOperationMode) {
            await this.push(this.switchServiceFanOnlyOperationMode, C.On, () => this.handleFanOnlyOperationModeGet());
        }
        if (this.outdoorTemperatureSensorService) {
            await this.push(this.outdoorTemperatureSensorService, C.CurrentTemperature, () => this.handleOutdoorTemperatureGet());
        }
        if (this.faultContactSensorService) {
            await this.push(this.faultContactSensorService, C.ContactSensorState, () => this.handleFaultGet());
        }
    }

    private async push(service: Service, characteristic: Parameters<Service['updateCharacteristic']>[0], getter: () => Promise<CharacteristicValue>) {
        try {
            service.updateCharacteristic(characteristic, await getter());
        } catch (e) {
            this.platform.log.debug(`[${this.name}] Skip syncing characteristic: ${e}`);
        }
    }

    async handleActiveStateGet(): Promise<CharacteristicValue> {
        const state = this.accessory.context.device.getData(this.managementPointId, 'onOffMode', undefined).value;
        this.platform.log.debug(`[${this.name}] GET ActiveState, state: ${state}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        return state === DaikinOnOffModes.ON;
    }

    async handleActiveStateSet(value: CharacteristicValue) {
        this.platform.log.debug(`[${this.name}] SET ActiveState, state: ${value}`);
        const state = value as boolean;
        await this.setData('onOffMode', undefined, state ? DaikinOnOffModes.ON : DaikinOnOffModes.OFF);
    }

    async handleCurrentTemperatureGet(): Promise<CharacteristicValue> {
        const temperature = this.accessory.context.device.getData(this.managementPointId, 'sensoryData', '/' + this.getCurrentControlMode()).value;
        this.platform.log.debug(`[${this.name}] GET CurrentTemperature, temperature: ${temperature}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        return temperature;
    }

    async handleOutdoorTemperatureGet(): Promise<CharacteristicValue> {
        const temperature = this.accessory.context.device.getData(this.managementPointId, 'sensoryData', '/outdoorTemperature').value;
        this.platform.log.debug(`[${this.name}] GET OutdoorTemperature, temperature: ${temperature}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        return temperature;
    }

    async handleFaultGet(): Promise<CharacteristicValue> {
        const isInErrorState = this.accessory.context.device.getData(this.managementPointId, 'isInErrorState', undefined).value;
        this.platform.log.debug(`[${this.name}] GET Fault, isInErrorState: ${isInErrorState}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        // ContactSensor: "contact not detected" (open) signals a fault, so the Home app can notify on it.
        return isInErrorState
            ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
            : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED;
    }

    async handleCoolingThresholdTemperatureGet(): Promise<CharacteristicValue> {
        const temperature = this.accessory.context.device.getData(this.managementPointId, 'temperatureControl', `/operationModes/${DaikinOperationModes.COOLING}/setpoints/${this.getSetpoint(DaikinOperationModes.COOLING)}`).value;
        this.platform.log.debug(`[${this.name}] GET CoolingThresholdTemperature, temperature: ${temperature}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        return temperature;
    }

    async handleCoolingThresholdTemperatureSet(value: CharacteristicValue) {
        const temperature = Math.round(value as number * 2) / 2;
        this.platform.log.debug(`[${this.name}] SET CoolingThresholdTemperature, temperature to: ${temperature}`);
        await this.setData('temperatureControl', `/operationModes/${DaikinOperationModes.COOLING}/setpoints/${this.getSetpoint(DaikinOperationModes.COOLING)}`, temperature);
    }

    async handleRotationSpeedGet(): Promise<CharacteristicValue> {
        const speed = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/modes/fixed`).value;
        this.platform.log.debug(`[${this.name}] GET RotationSpeed, speed: ${speed}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        return speed;
    }

    async handleRotationSpeedSet(value: CharacteristicValue) {
        const speed = value as number;
        this.platform.log.debug(`[${this.name}] SET RotationSpeed, speed to: ${speed}`);
        await this.setData('fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/currentMode`, 'fixed');
        await this.setData('fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/modes/fixed`, speed);
    }

    async handleHeatingThresholdTemperatureGet(): Promise<CharacteristicValue> {
        const temperature = this.accessory.context.device.getData(this.managementPointId, 'temperatureControl', `/operationModes/${DaikinOperationModes.HEATING}/setpoints/${this.getSetpoint(DaikinOperationModes.HEATING)}`).value;
        this.platform.log.debug(`[${this.name}] GET HeatingThresholdTemperature, temperature: ${temperature}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        return temperature;
    }

    async handleHeatingThresholdTemperatureSet(value: CharacteristicValue) {
        const temperature = Math.round(value as number * 2) / 2;
        this.platform.log.debug(`[${this.name}] SET HeatingThresholdTemperature, temperature to: ${temperature}`);
        await this.setData('temperatureControl', `/operationModes/${DaikinOperationModes.HEATING}/setpoints/${this.getSetpoint(DaikinOperationModes.HEATING)}`, temperature);
    }

    async handleTargetHeaterCoolerStateGet(): Promise<CharacteristicValue> {
        const operationMode: DaikinOperationModes = this.getCurrentOperationMode();
        this.platform.log.debug(`[${this.name}] GET TargetHeaterCoolerState, operationMode: ${operationMode}, last update: ${this.accessory.context.device.getLastUpdated()}`);

        switch (operationMode) {
            case DaikinOperationModes.COOLING:
                return this.platform.Characteristic.TargetHeaterCoolerState.COOL;
            case DaikinOperationModes.HEATING:
                return this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
            case DaikinOperationModes.DRY:
                this.addOrUpdateCharacteristicRotationSpeed();
                return this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
            default:
                return this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
        }
    }

    async handleTargetHeaterCoolerStateSet(value: CharacteristicValue) {
        const operationMode = value as number;
        this.platform.log.debug(`[${this.name}] SET TargetHeaterCoolerState, OperationMode to: ${value}`);
        let daikinOperationMode: DaikinOperationModes = DaikinOperationModes.COOLING;

        switch (operationMode) {
            case this.platform.Characteristic.TargetHeaterCoolerState.COOL:
                daikinOperationMode = DaikinOperationModes.COOLING;
                break;
            case this.platform.Characteristic.TargetHeaterCoolerState.HEAT:
                daikinOperationMode = DaikinOperationModes.HEATING;
                break;
            case this.platform.Characteristic.TargetHeaterCoolerState.AUTO:
                daikinOperationMode = DaikinOperationModes.AUTO;
                break;
        }

        this.platform.log.debug(`[${this.name}] SET TargetHeaterCoolerState, daikinOperationMode to: ${daikinOperationMode}`);
        await this.setData('operationMode', undefined, daikinOperationMode);
        await this.setData('onOffMode', undefined, DaikinOnOffModes.ON);
    }

    async handleSwingModeSet(value: CharacteristicValue) {
        const swingMode = value as number;
        const daikinSwingMode = swingMode === 1 ? DaikinFanDirectionHorizontalModes.SWING : DaikinFanDirectionHorizontalModes.STOP;
        this.platform.log.debug(`[${this.name}] SET SwingMode, swingmode to: ${swingMode}/${daikinSwingMode}`);

        if (this.hasSwingModeHorizontalFeature()) {
            await this.setData('fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanDirection/horizontal/currentMode`, daikinSwingMode);
        }

        if (this.hasSwingModeVerticalFeature()) {
            await this.setData('fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanDirection/vertical/currentMode`, daikinSwingMode);
        }
    }

    async handleSwingModeGet(): Promise<CharacteristicValue> {
        const verticalSwingMode = this.hasSwingModeVerticalFeature() ? this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanDirection/vertical/currentMode`).value : null;
        const horizontalSwingMode = this.hasSwingModeHorizontalFeature() ? this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanDirection/horizontal/currentMode`).value : null;
        this.platform.log.debug(`[${this.name}] GET SwingMode, verticalSwingMode: ${verticalSwingMode}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        this.platform.log.debug(`[${this.name}] GET SwingMode, horizontalSwingMode: ${horizontalSwingMode}, last update: ${this.accessory.context.device.getLastUpdated()}`);

        if (horizontalSwingMode === DaikinFanDirectionHorizontalModes.STOP || verticalSwingMode === DaikinFanDirectionVerticalModes.STOP) {
            return this.platform.Characteristic.SwingMode.SWING_DISABLED;
        }

        return this.platform.Characteristic.SwingMode.SWING_ENABLED;
    }

    async handlePowerfulModeGet() {
        const powerfulModeOn = this.accessory.context.device.getData(this.managementPointId, 'powerfulMode', undefined).value === DaikinPowerfulModes.ON;
        this.platform.log.debug(`[${this.name}] GET PowerfulMode, powerfulModeOn: ${powerfulModeOn}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        return powerfulModeOn;
    }

    async handlePowerfulModeSet(value: CharacteristicValue) {
        this.platform.log.debug(`[${this.name}] SET PowerfulMode to: ${value}`);
        const daikinPowerfulMode = value as boolean ? DaikinPowerfulModes.ON : DaikinPowerfulModes.OFF;
        await this.setData('powerfulMode', undefined, daikinPowerfulMode);
    }

    async handleEconoModeGet() {
        const econoModeOn = this.accessory.context.device.getData(this.managementPointId, 'econoMode', undefined).value === DaikinEconoModes.ON;
        this.platform.log.debug(`[${this.name}] GET EconoMode, econoModeOn: ${econoModeOn}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        return econoModeOn;
    }

    async handleEconoModeSet(value: CharacteristicValue) {
        this.platform.log.debug(`[${this.name}] SET EconoMode to: ${value}`);
        const daikinEconoMode = value as boolean ? DaikinEconoModes.ON : DaikinEconoModes.OFF;
        await this.setData('econoMode', undefined, daikinEconoMode);
    }

    async handleStreamerModeGet() {
        const streamerModeOn = this.accessory.context.device.getData(this.managementPointId, 'streamerMode', undefined).value === DaikinStreamerModes.ON;
        this.platform.log.debug(`[${this.name}] GET StreamerMode, streamerModeOn: ${streamerModeOn}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        return streamerModeOn;
    }

    async handleStreamerModeSet(value: CharacteristicValue) {
        this.platform.log.debug(`[${this.name}] SET streamerMode to: ${value}`);
        const daikinStreamerMode = value as boolean ? DaikinStreamerModes.ON : DaikinStreamerModes.OFF;
        await this.setData('streamerMode', undefined, daikinStreamerMode);
    }

    async handleOutdoorSilentModeGet() {
        const outdoorSilentModeOn = this.accessory.context.device.getData(this.managementPointId, 'outdoorSilentMode', undefined).value === DaikinOutdoorSilentModes.ON;
        this.platform.log.debug(`[${this.name}] GET OutdoorSilentMode, outdoorSilentModeOn: ${outdoorSilentModeOn}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        return outdoorSilentModeOn;
    }

    async handleOutdoorSilentModeSet(value: CharacteristicValue) {
        this.platform.log.debug(`[${this.name}] SET outdoorSilentMode to: ${value}`);
        const daikinOutdoorSilentMode = value as boolean ? DaikinOutdoorSilentModes.ON : DaikinOutdoorSilentModes.OFF;
        await this.setData('outdoorSilentMode', undefined, daikinOutdoorSilentMode);
    }

    async handleIndoorSilentModeGet() {
        const indoorSilentModeOn = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/currentMode`).value === DaikinFanSpeedModes.QUIET;
        this.platform.log.debug(`[${this.name}] GET IndoorSilentMode, indoorSilentModeOn: ${indoorSilentModeOn}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        return indoorSilentModeOn;
    }

    async handleIndoorSilentModeSet(value: CharacteristicValue) {
        this.platform.log.debug(`[${this.name}] SET indoorSilentMode to: ${value}`);
        const daikinFanSpeedMode = value as boolean ? DaikinFanSpeedModes.QUIET : DaikinFanSpeedModes.FIXED;
        await this.setData('fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/currentMode`, daikinFanSpeedMode);
    }

    async handleFanAutoModeGet() {
        const fanAutoModeOn = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/currentMode`).value === DaikinFanSpeedModes.AUTO;
        this.platform.log.debug(`[${this.name}] GET FanAutoMode, fanAutoModeOn: ${fanAutoModeOn}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        return fanAutoModeOn;
    }

    async handleFanAutoModeSet(value: CharacteristicValue) {
        this.platform.log.debug(`[${this.name}] SET fanAutoMode to: ${value}`);
        // Auto and the manual speed (fixed) are mutually exclusive modes of the same fanSpeed datapoint, so turning
        // Auto off falls back to manual/fixed.
        const daikinFanSpeedMode = value as boolean ? DaikinFanSpeedModes.AUTO : DaikinFanSpeedModes.FIXED;
        await this.setData('fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/currentMode`, daikinFanSpeedMode);
    }

    async handleDryOperationModeGet() {
        const dryOperationModeOn = this.accessory.context.device.getData(this.managementPointId, 'operationMode', undefined).value === DaikinOperationModes.DRY;
        this.platform.log.debug(`[${this.name}] GET DryOperationMode, dryOperationModeOn: ${dryOperationModeOn}, last update: ${this.accessory.context.device.getLastUpdated()}`);

        return dryOperationModeOn;
    }

    async handleDryOperationModeSet(value: CharacteristicValue) {
        this.platform.log.debug(`[${this.name}] SET DryOperationMode to: ${value}`);
        const daikinOperationMode = value as boolean ? DaikinOperationModes.DRY : DaikinOperationModes.AUTO;
        await this.setData('operationMode', undefined, daikinOperationMode);
    }

    async handleFanOnlyOperationModeGet() {
        const fanOnlyOperationModeOn = this.accessory.context.device.getData(this.managementPointId, 'operationMode', undefined).value === DaikinOperationModes.FAN_ONLY;
        this.platform.log.debug(`[${this.name}] GET FanOnlyOperationMode, fanOnlyOperationModeOn: ${fanOnlyOperationModeOn}, last update: ${this.accessory.context.device.getLastUpdated()}`);
        return fanOnlyOperationModeOn;
    }

    async handleFanOnlyOperationModeSet(value: CharacteristicValue) {
        this.platform.log.debug(`[${this.name}] SET FanOnlyOperationMode to: ${value}`);
        const daikinOperationMode = value as boolean ? DaikinOperationModes.FAN_ONLY : DaikinOperationModes.AUTO;
        await this.setData('operationMode', undefined, daikinOperationMode);
    }

    getCurrentOperationMode(): DaikinOperationModes {
        return this.accessory.context.device.getData(this.managementPointId, 'operationMode', undefined).value;
    }

    getCurrentControlMode(): DaikinControlModes {
        const controlMode = this.accessory.context.device.getData(this.managementPointId, 'controlMode', undefined);

        // Only Altherma devices have a controlMode, others have a fixed controlMode of ROOM_TEMPERATURE AFAIK
        if (!controlMode) {
            return DaikinControlModes.ROOM_TEMPERATURE;
        }

        return controlMode.value;
    }

    getSetpointMode(): DaikinSetpointModes | null {
        const setpointMode = this.accessory.context.device.getData(this.managementPointId, 'setpointMode', undefined);
        if (!setpointMode) {
            return null;
        }
        return setpointMode.value;
    }

    getSetpoint(operationMode: DaikinOperationModes): DaikinTemperatureControlSetpoints {
        // depending on the settings of the device the temperatureControl can be set in different ways "DaikinTemperatureControlSetpoints"
        // Docs: https://developer.cloud.daikineurope.com/docs/b0dffcaa-7b51-428a-bdff-a7c8a64195c0/supported_features
        // Looks like the setpointMode is the most important one to determine the setpoint,
        // then the controleMode and in case of weatherDependentHeatingFixedCooling also the operation mode
        // If the setpointMode is not available (in case on non-Althermas), we can use the controlMode to determine the setpoint

        const setpointMode = this.getSetpointMode();
        const controlMode = this.getCurrentControlMode();

        if (setpointMode) {
            switch (setpointMode) {
                case DaikinSetpointModes.FIXED:
                    switch (controlMode) {
                        case DaikinControlModes.LEAVING_WATER_TEMPERATURE:
                            return DaikinTemperatureControlSetpoints.LEAVING_WATER_TEMPERATURE;
                        default:
                            return DaikinTemperatureControlSetpoints.ROOM_TEMPERATURE;
                    }
                case DaikinSetpointModes.WEATHER_DEPENDENT:
                    switch (controlMode) {
                        case DaikinControlModes.LEAVING_WATER_TEMPERATURE:
                            return DaikinTemperatureControlSetpoints.LEAVING_WATER_OFFSET;
                        default:
                            return DaikinTemperatureControlSetpoints.ROOM_TEMPERATURE;
                    }
                case DaikinSetpointModes.WEATHER_DEPENDENT_HEATING_FIXED_COOLING:
                    switch (controlMode) {
                        case DaikinControlModes.ROOM_TEMPERATURE:
                            return DaikinTemperatureControlSetpoints.ROOM_TEMPERATURE;
                        case DaikinControlModes.LEAVING_WATER_TEMPERATURE:
                            switch (operationMode) {
                                case DaikinOperationModes.HEATING:
                                    return DaikinTemperatureControlSetpoints.LEAVING_WATER_OFFSET;
                                case DaikinOperationModes.COOLING:
                                    return DaikinTemperatureControlSetpoints.LEAVING_WATER_TEMPERATURE;
                            }
                    }
            }


            throw new Error(`Could not determine the TemperatureControlSetpoint for operationMode: ${operationMode}, setpointMode: ${setpointMode}, controlMode: ${controlMode}, for device: ${JSON.stringify(DaikinCloudRepo.maskSensitiveCloudDeviceData(this.accessory.context.device.desc), null, 4)}`);
        }

        switch (controlMode) {
            case DaikinControlModes.LEAVING_WATER_TEMPERATURE:
                return DaikinTemperatureControlSetpoints.LEAVING_WATER_OFFSET;
            default:
                return DaikinTemperatureControlSetpoints.ROOM_TEMPERATURE;
        }
    }

    hasSwingModeVerticalFeature() {
        const verticalSwing = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanDirection/vertical/currentMode`);
        this.platform.log.debug(`[${this.name}] hasSwingModeFeature, verticalSwing: ${Boolean(verticalSwing)}`);
        return Boolean(verticalSwing);
    }

    hasSwingModeHorizontalFeature() {
        const horizontalSwing = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanDirection/horizontal/currentMode`);
        this.platform.log.debug(`[${this.name}] hasSwingModeFeature, horizontalSwing: ${Boolean(horizontalSwing)}`);
        return Boolean(horizontalSwing);
    }

    hasSwingModeFeature() {
        return Boolean(this.hasSwingModeVerticalFeature() || this.hasSwingModeHorizontalFeature());
    }

    hasPowerfulModeFeature() {
        const powerfulMode = this.accessory.context.device.getData(this.managementPointId, 'powerfulMode', undefined);
        this.platform.log.debug(`[${this.name}] hasPowerfulModeFeature, powerfulMode: ${Boolean(powerfulMode)}`);
        return Boolean(powerfulMode);
    }

    hasEconoModeFeature() {
        const econoMode = this.accessory.context.device.getData(this.managementPointId, 'econoMode', undefined);
        this.platform.log.debug(`[${this.name}] hasEconoModeFeature, econoMode: ${Boolean(econoMode)}`);
        return Boolean(econoMode);
    }

    hasStreamerModeFeature() {
        const streamerMode = this.accessory.context.device.getData(this.managementPointId, 'streamerMode', undefined);
        this.platform.log.debug(`[${this.name}] hasStreamerModeFeature, streamerMode: ${Boolean(streamerMode)}`);
        return Boolean(streamerMode);
    }

    hasOutdoorSilentModeFeature() {
        const OutdoorSilentMode = this.accessory.context.device.getData(this.managementPointId, 'outdoorSilentMode', undefined);
        this.platform.log.debug(`[${this.name}] hasOutdoorSilentModeFeature, outdoorSilentMode: ${Boolean(OutdoorSilentMode)}`);
        return Boolean(OutdoorSilentMode);
    }

    hasIndoorSilentModeFeature() {
        const currentModeFanControl = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/currentMode`);
        if (!currentModeFanControl) {
            return false;
        }
        const fanSpeedValues: Array<string> = currentModeFanControl.values;
        this.platform.log.debug(`[${this.name}] hasIndoorSilentModeFeature, indoorSilentMode: ${fanSpeedValues.includes(DaikinFanSpeedModes.QUIET)}`);
        return fanSpeedValues.includes(DaikinFanSpeedModes.QUIET);
    }

    hasFanAutoModeFeature() {
        const currentModeFanControl = this.accessory.context.device.getData(this.managementPointId, 'fanControl', `/operationModes/${this.getCurrentOperationMode()}/fanSpeed/currentMode`);
        if (!currentModeFanControl) {
            return false;
        }
        const fanSpeedValues: Array<string> = currentModeFanControl.values;
        this.platform.log.debug(`[${this.name}] hasFanAutoModeFeature, fanAutoMode: ${fanSpeedValues.includes(DaikinFanSpeedModes.AUTO)}`);
        return fanSpeedValues.includes(DaikinFanSpeedModes.AUTO);
    }

    hasOperationMode(operationMode: DaikinOperationModes) {
        const operationModeValues: Array<string> = this.accessory.context.device.getData(this.managementPointId, 'operationMode', undefined).values;
        this.platform.log.debug(`[${this.name}] has ${operationMode}: ${operationModeValues.includes(operationMode)}`);
        return operationModeValues.includes(operationMode);
    }

    hasDryOperationModeFeature() {
        return this.hasOperationMode(DaikinOperationModes.DRY);
    }

    hasFanOnlyOperationModeFeature() {
        return this.hasOperationMode(DaikinOperationModes.FAN_ONLY);
    }
}

enum DaikinFanSpeedModes {
    AUTO = 'auto',
    QUIET = 'quiet',
    FIXED = 'fixed',
}

enum DaikinOutdoorSilentModes {
    ON = 'on',
    OFF = 'off',
}

enum DaikinOnOffModes {
    ON = 'on',
    OFF = 'off',
}

enum DaikinStreamerModes {
    ON = 'on',
    OFF = 'off',
}

enum DaikinEconoModes {
    ON = 'on',
    OFF = 'off',
}

export enum DaikinPowerfulModes {
    ON = 'on',
    OFF = 'off',
}

enum DaikinFanDirectionHorizontalModes {
    STOP = 'stop',
    SWING = 'swing',
}

enum DaikinFanDirectionVerticalModes {
    STOP = 'stop',
    SWING = 'swing',
    WIND_NICE = 'windNice',
}

enum DaikinOperationModes {
    FAN_ONLY = 'fanOnly',
    HEATING = 'heating',
    COOLING = 'cooling',
    AUTO = 'auto',
    DRY = 'dry',
}

enum DaikinControlModes {
    ROOM_TEMPERATURE = 'roomTemperature',
    LEAVING_WATER_TEMPERATURE = 'leavingWaterTemperature',
    EXTERNAL_ROOM_TEMPERATURE = 'externalRoomTemperature',
}

enum DaikinTemperatureControlSetpoints {
    ROOM_TEMPERATURE = 'roomTemperature',
    LEAVING_WATER_OFFSET = 'leavingWaterOffset',
    LEAVING_WATER_TEMPERATURE = 'leavingWaterTemperature',
}

enum DaikinSetpointModes {
    FIXED = 'fixed',
    WEATHER_DEPENDENT_HEATING_FIXED_COOLING = 'weatherDependentHeatingFixedCooling',
    WEATHER_DEPENDENT = 'weatherDependent'
}
