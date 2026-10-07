import type { ScenarioPack } from "../world";
import { baseline, WAREHOUSE } from "./baseline";
import { queueFailure } from "./queue-failure";
import { wptNotDetermined } from "./wpt-not-determined";
import { wtNotCreated } from "./wt-not-created";

/** Every scenario pack loaded into a simulated system, in the order their tickets are offered. */
export const SCENARIO_PACKS: readonly ScenarioPack[] = [wtNotCreated, queueFailure, wptNotDetermined];

export { baseline, WAREHOUSE as SIMULATED_WAREHOUSE };
