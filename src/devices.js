// -----------------------------------------------------------------------------
// The Gladys devices of the Zinvolt batteries and their states. Pure.
//
// External id (forever): battery:<serial number> (src/zinvolt/model.js
// batteryKey). Feature keys (forever): see FEATURE below.
//
// Energy rules of the Gladys core (server/utils/constants.js and the lot 6
// rules of this project): the API gives NO energy counter (no kWh at all),
// only powers; none is ever made up from a power. So no `index`, no
// `daily-*`, never publishEnergyConsumption: the energy monitoring of Gladys
// is left to the main meter. The signed battery power is a plain sensor (its
// sign follows Home Assistant, `0 - pso`, to confirm); the solar power is
// energy-production-sensor / power, the power given to the home socket
// home-output-sensor / power (>= 0).
//
// Units: only the ones the core lists for the category
// (DEVICE_FEATURE_UNITS_BY_CATEGORY): % for battery-storage, W for
// energy-production-sensor and home-output-sensor, none for unknown (the unit
// is then in the name).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { EXTERNAL_ID_TYPE, POWER_MAX } from './constants.js';

/** Feature keys (forever). */
export const FEATURE = {
  SOC: 'soc',
  BATTERY_POWER: 'battery_power',
  PV_POWER: 'pv_power',
  OUTPUT_POWER: 'output_power',
  POWER_LIMIT: 'power_limit',
  ONLINE: 'online',
  ON_GRID: 'on_grid',
  DORMANT: 'dormant',
  SMART_MODE: 'smart_mode',
  MAX_OUTPUT: 'max_output',
  UPPER_LIMIT: 'upper_limit',
  LOWER_LIMIT: 'lower_limit',
  MAX_CHARGE_POWER: 'max_charge_power',
  STANDBY_TIME: 'standby_time',
};

/** The external ids of a battery. */
export const ids = (gladys, key) => gladys.externalIds(EXTERNAL_ID_TYPE, key);

// --- The catalog ------------------------------------------------------------------
//
// Each entry: the feature key, the value of src/zinvolt/model.js it shows, its
// rounding, and how it is declared.

const def = (key, value, digits, spec) => ({ key, value, digits, spec });
const measure = (name, category, type, extra = {}) => ({ name, category, type, ...extra });
/** A value shown, never summed nor billed: no energy category, no unit (it is in the name). */
const plain = (name, extra = {}) => measure(name, C.UNKNOWN, T.SENSOR.DECIMAL, extra);
const code = (name, max) => measure(name, C.UNKNOWN, T.SENSOR.INTEGER, { max });
const watts = (name, category, type) =>
  measure(name, category, type, { unit: U.WATT, max: POWER_MAX });

export const CATALOG = [
  def(FEATURE.SOC, 'soc', 0, {
    ...measure('State of charge', C.BATTERY_STORAGE, T.BATTERY_STORAGE.BATTERY_LEVEL),
    unit: U.PERCENT,
    max: 100,
  }),
  // No typed charge / discharge power in v1: the sign is not established on a
  // real battery, and a wrong one would fill their history forever.
  def(
    FEATURE.BATTERY_POWER,
    'batteryPower',
    0,
    plain('Battery power (W, > 0 supplying, < 0 taking, sign to confirm)', {
      min: -POWER_MAX,
      max: POWER_MAX,
    }),
  ),
  def(
    FEATURE.PV_POWER,
    'pvPower',
    0,
    watts('Solar power', C.ENERGY_PRODUCTION_SENSOR, T.ENERGY_PRODUCTION_SENSOR.POWER),
  ),
  def(
    FEATURE.OUTPUT_POWER,
    'outputPower',
    0,
    watts('Power to the home socket', C.HOME_OUTPUT_SENSOR, T.HOME_OUTPUT_SENSOR.POWER),
  ),
  def(FEATURE.POWER_LIMIT, 'powerLimit', 0, plain('System power limit (W)', { max: POWER_MAX })),
  def(FEATURE.ONLINE, 'online', 0, code('Online (1 = yes, 0 = no)', 1)),
  def(FEATURE.ON_GRID, 'onGrid', 0, code('On grid (1 = yes, 0 = no)', 1)),
  def(FEATURE.DORMANT, 'dormant', 0, code('Dormant (1 = yes, 0 = no)', 1)),
  def(
    FEATURE.SMART_MODE,
    'smartMode',
    0,
    code(
      'Smart mode (0 = default, 1 = self use, 2 = dynamic, 3 = charged, 4 = performance, 5 = feed, 6 = custom)',
      6,
    ),
  ),
  def(FEATURE.MAX_OUTPUT, 'maxOutput', 0, plain('Maximum output setting (W)', { max: POWER_MAX })),
  def(FEATURE.UPPER_LIMIT, 'upperLimit', 0, plain('Charge upper limit (%)', { max: 100 })),
  def(FEATURE.LOWER_LIMIT, 'lowerLimit', 0, plain('Discharge lower limit (%)', { max: 100 })),
  def(
    FEATURE.MAX_CHARGE_POWER,
    'maxChargePower',
    0,
    plain('Maximum charge power setting (W)', { max: POWER_MAX }),
  ),
  def(FEATURE.STANDBY_TIME, 'standbyTime', 0, plain('Standby time (min)', { max: 100_000 })),
];

/**
 * The device of a battery (`{ key, id, serial, name }`). The whole catalog,
 * always: a device published again never loses a feature ("Update" in
 * Discovery would drop its history).
 */
export function buildDevice(gladys, battery) {
  const external = ids(gladys, battery.key);
  const features = CATALOG.map(({ key, spec }) => ({
    min: 0,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    ...spec,
    external_id: external.feature(key),
  }));
  return {
    name: battery.name ?? `Zinvolt ${battery.serial || battery.key}`,
    external_id: external.device,
    features,
    params: [
      { name: 'ZINVOLT_SERIAL', value: battery.serial ?? '' },
      { name: 'ZINVOLT_ID', value: battery.id ?? '' },
    ],
  };
}

export const round = (value, digits) => {
  const r = Math.round(value * 10 ** digits) / 10 ** digits;
  return Object.is(r, -0) ? 0 : r;
};

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** The states of a battery read. `values`: src/zinvolt/model.js parseCurrentState. */
export function readStates(external, values) {
  const states = [];
  for (const { key, value, digits, spec } of CATALOG) {
    const v = values[value];
    if (!isNumber(v)) {
      continue;
    }
    const r = round(v, digits);
    const min = spec.min ?? 0;
    if (r < min || (spec.max !== undefined && r > spec.max)) {
      continue;
    }
    states.push({ device_feature_external_id: external.feature(key), state: r });
  }
  return states;
}
