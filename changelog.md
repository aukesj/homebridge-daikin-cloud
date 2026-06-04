# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).


## [3.0.0] - 2026-06-04

This is a renamed fork (`homebridge-daikin-onecta`, platform `DaikinOnecta`) so it can run alongside or in place of the
original plugin. Because the plugin name and the accessory serial numbers change, HomeKit will see the devices as new
accessories: you will need to re-assign rooms and re-create scenes/automations once after switching.

### Fixed

- **Turning on one air conditioner could turn on all of them.** The debug-logging mask helper overwrote
  `serialNumber.value` with `'REDACTED'` in place — on the live device cache — for every device just before its
  accessory was created. All accessories then got the identical SerialNumber `'REDACTED'`, so the Apple Home app
  treated them as one physical accessory and mirrored commands. The mask now deep-clones first and no longer touches
  the real data. (As an extra safeguard, when a device genuinely reports no serial number the accessory now falls back
  to the unique device id instead of a constant.)
- Failed cloud writes are no longer swallowed silently: they surface to HomeKit (which shows "No Response" and reverts)
  instead of pretending the change succeeded.

### Added

- **State stays consistent with a laggy cloud.** A value you set is held and re-asserted to the cloud until confirmed,
  so a poll that still reads the old cloud state no longer reverts your choice (e.g. setpoint jumping back).
- **External changes show up automatically.** After each poll the current state is pushed to HomeKit, so changes made
  in the Onecta app appear without having to open the Home app.
- **Outdoor temperature sensor** (when the device reports it).
- **Fault sensor** as a contact sensor ("open" == fault) so you can enable Home notifications for unit errors.
- **Auto fan speed switch** alongside the existing manual fan-speed slider and indoor-silent switch (needs
  `showExtraFeatures`).
- Firmware version is now shown on the accessory.

### Changed

- Default poll interval lowered from 15 to 10 minutes (one poll is a single API call for all devices; 10 min = 144/day,
  within the 200/day rate limit) so external changes show up sooner.

## [2.9.0] - 2025-01-30

### Added

- Added `CurrentHeatingCoolingState` characteristic for Hot Wat Tank 
- Added Powerful mode switch for Hot Wat Tank (when using the `showExtraFeatures` option)
- Added a lot of "e2e" tests with device mocks shared in the issues so we can spot regressions more easily

### Updated

- Improved the way we decide on which setpoint to use when getting and setting the `temperatureControl` (https://github.com/JeroenVdb/homebridge-daikin-cloud/pull/100) (solves https://github.com/JeroenVdb/homebridge-daikin-cloud/issues/98)
- `TargetHeatingCoolingState` will show `off` when onOffMode is `off`
- `TargetHeatingCoolingState` will set onOffMode to `off` when target `off` is picked
- `TargetHeatingCoolingState` only includes tha states (heating, cooling, auto, off) that are available in your device

## [2.8.1] - 2025-01-23

### Added

- Extra debugging information for when Hot Water Tank operations fail

## [2.8.0] - 2025-01-23

In this update the plugin will remove the `.daikin-controller-cloud-tokenset` file containing your oauth credentials as soon as the refresh token is marked as invalidated. This prevents people having to manually remove the file when the refresh token is invalidated. A restart of Homebridge is required after the file is removed to restart the authorisation flow.

### Added

- Remove TokenSet file when refresh token is invalidated  

## [2.7.0] - 2024-10-22

### Added

- Update dependencies

### Fixes

- Update Altherma support (fixes
  https://github.com/JeroenVdb/homebridge-daikin-cloud/issues/81)
- Fix for devices that don't have both horizontal and vertical swing (fixes https://github.com/JeroenVdb/homebridge-daikin-cloud/issues/89)

## [2.6.0] - 2024-08-11

### Added

- Refactored the way accessories and services are used, so we can more easily support extra devices.

### Fixes

- Optional add CoolingThresholdTemperature and heatingThresholdTemperature for devices that don't support roomTemperature temperature control (fixes 
  https://github.com/JeroenVdb/homebridge-daikin-cloud/issues/81)

## [2.5.0] - 2024-08-05

### Added

- Extra switches for operation modes: dry and fan only, showExtraFeatures must be enabled as well. (fixes https://github.com/JeroenVdb/homebridge-daikin-cloud/issues/57,
  https://github.com/JeroenVdb/homebridge-daikin-cloud/issues/45 and https://github.com/JeroenVdb/homebridge-daikin-cloud/issues/25)
- Update Homebridge + add Homebridge 2.0 beta support

### Fixed

- Some devices don't support heating, we now gracefully handle that (fixes https://github.com/JeroenVdb/homebridge-daikin-cloud/issues/50)

## [2.4.1] - 2024-07-30

### Added

- Extra configuration `forceUpdateDelay`: The amount of time to wait before updating the device data again after a change (PATCH) has been made. This can be 
  useful if you have a device that is not updating correctly (fixes https://github.com/JeroenVdb/homebridge-daikin-cloud/issues/55#issuecomment-2256455690)

## [2.4.0] - 2024-07-09

### Added

- Some extra documentation about the config parameter related to the authorisation flow

### Fixed

- When operation mode is dry you should not be able to set or get the rotation speed because it is not a characteristics for dry mode (fixes https://github.com/JeroenVdb/homebridge-daikin-cloud/issues/66)

## [2.3.0] - 2024-07-02  - 2024-07-04

### Added

- Update daikin-cloud-controller: the controller will now block communication to Daikin when it detects that you have hit your rate limit. If this is not
  done you will start consuming calls from your next rate limit window. See: https://github.com/Apollon77/daikin-controller-cloud/pull/147

## [2.2.0] - 2024-07-02  - 2024-07-04

### Added

### Changed

- Changed the way we poll the Daikin API, see readme for more details on the current logic

### Fixed

## [2.0.0 - 2.1.0] - 2024-07-02  - 2024-07-03

### Added

- Switch to using the new Daikin Cloud API. (!) PLEASE READ THE README AND CHANGE YOUR CONFIG (!)

### Changed

### Fixed

## [1.8.0-beta.0] - 2023-09-05

### Added

- Support for Altherma (fixes https://github.com/JeroenVdb/homebridge-daikin-cloud/issues/30)

### Changed

### Fixed

## [1.7.3] - 2024-03-10

### Added

- Warning about why login sometimes will fail (https://github.com/JeroenVdb/homebridge-daikin-cloud/issues/51)

## [1.7.0] - 2023-09-03

### Added

- Switch for indoor silent/quiet fan speed mode (fixes https://github.com/JeroenVdb/homebridge-daikin-cloud/issues/33)

### Changed

### Fixed

## [1.6.0] - 2023-08-31

### Added

- It is now possible, via the config, to exclude specific devices (fixes https://github.com/JeroenVdb/homebridge-daikin-cloud/issues/31)

### Changed

### Fixed

## [1.5.5] - 2023-08-31

### Added

### Changed

### Fixed

- Fix crashing plugin because it was published before the final commit (fixes https://github.com/JeroenVdb/homebridge-daikin-cloud/issues/38)

## [1.5.3] - 2023-08-24

### Added

### Changed

- Moved detailed logging from the info level to debug. Enable Debug Mode to see the logging again (fixes https://github.com/JeroenVdb/homebridge-daikin-cloud/issues/34)

### Fixed

## [1.5.2] - 2023-03-09

### Added

### Changed

### Fixed

- The plugin crashed when it tries to convert a non-airco device to a HeaterCooler accessory (fixes https://github.com/JeroenVdb/homebridge-daikin-cloud/issues/29)

## [1.5.1] - 2023-02-28

Labels are back!

### Added

- Add funding link to https://www.paypal.me/jrnvdb

### Changed

### Fixed

## [1.5.0] - 2023-02-28

Labels are back!

### Added

### Changed

### Fixed

- Labels now have the correct label again. Restarting Homebridge and Home should bring back the labels (https://github.com/JeroenVdb/homebridge-daikin-cloud/issues/27)

## [1.4.0] - 2022-09-28

Here we would have the update steps for 1.2.4 for people to follow.

### Added

### Changed

### Fixed

- Merged https://github.com/JeroenVdb/homebridge-daikin-cloud/pull/16 which fixes an incompatibility for users using fahrenheit
- Extra services are now also removed after settings the showExtraFeatures option from true to false (https://github.com/JeroenVdb/homebridge-daikin-cloud/commit/11ffb863ab7b99906a23e8ae816302bf47940f0a)
