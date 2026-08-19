// Named, deterministic setups the screenshot harness and critics can jump to.
// Any module may register one: registerScenario('name', { seed, setup(ctx), settle })
const REG = new Map();
export function registerScenario(name, def) { REG.set(name, def); }
export function listScenarios() { return [...REG.keys()]; }
export function getScenario(name) { return REG.get(name); }
