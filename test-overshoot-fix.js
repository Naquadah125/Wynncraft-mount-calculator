// Quick test to verify overshoot fix
const fs = require('fs');
const path = require('path');

// Mock window for Node.js
global.window = {};

// Load dependencies in order
const constantsCode = fs.readFileSync(path.join(__dirname, 'js', 'constants.js'), 'utf8');
const tierUtilsCode = fs.readFileSync(path.join(__dirname, 'js', 'tier-utils.js'), 'utf8');
const materialTiersCode = fs.readFileSync(path.join(__dirname, 'js', 'material-tiers-fallback.js'), 'utf8');
const withTrainingCode = fs.readFileSync(path.join(__dirname, 'js', 'with-training-planner.js'), 'utf8');

let STATS, tierList, materialTiers, withTrainingPlanner;

// Execute constants
eval(constantsCode);
const { STATS: STATS_CONST } = global.window.APP_CONSTANTS;
STATS = STATS_CONST;

// Execute tier utils
eval(tierUtilsCode);

// Execute material tiers
eval(materialTiersCode);
materialTiers = global.window.MATERIAL_TIERS || {};

// Execute with-training planner
eval(withTrainingCode);
withTrainingPlanner = global.window.createWithTrainingPlanner;

// Create planner instance
const planner = withTrainingPlanner({
  STATS,
  pickTier,
  tierMinLevel
});

// Test with 1/10/30
const testInput = {
  algoMode: "optimal-max",
  currentValues: { Speed: 1, Acceleration: 1, Altitude: 1, Energy: 1, Handling: 1, Toughness: 1, Boost: 1, Training: 1 },
  limitValues: { Speed: 10, Acceleration: 10, Altitude: 10, Energy: 10, Handling: 10, Toughness: 10, Boost: 10, Training: 10 },
  maxValues: { Speed: 30, Acceleration: 30, Altitude: 30, Energy: 30, Handling: 30, Toughness: 30, Boost: 30, Training: 30 },
  activeTier: 1,
  materialTiers
};

console.log("Testing with 1/10/30 input...");
const result = planner.plan(testInput);

console.log(`Feasible: ${result.feasible}`);
if (!result.feasible) {
  console.log(`Reason: ${result.reason}`);
}
console.log(`Steps: ${result.steps.length}`);
console.log(`Materials Used: ${result.totalMaterialsUsed}`);
console.log(`Total Feeding Time: ${result.totalFeedingMinutes} minutes`);
console.log(`\nFirst 12 steps:`);
result.steps.slice(0, 12).forEach((step, idx) => {
  if (step.type === 'Eat' && step.items) {
    console.log(`${idx + 1}. ${step.type}: ${step.items.map(i => `${i.qty}x ${i.name}`).join(", ")}`);
  } else {
    console.log(`${idx + 1}. ${step.type}: ${step.text}`);
  }
});

console.log(`\nSteps 9-14 (problem area):`);
result.steps.slice(8, 14).forEach((step, idx) => {
  if (step.type === 'Eat' && step.items) {
    console.log(`${idx + 9}. ${step.type}: ${step.items.map(i => `${i.qty}x ${i.name}`).join(", ")}`);
  } else {
    console.log(`${idx + 9}. ${step.type}: ${step.text}`);
  }
});
