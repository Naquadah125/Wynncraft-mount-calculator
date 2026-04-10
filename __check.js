const fs = require('fs');
global.window = {};
eval(fs.readFileSync('algorithms.js','utf8'));
const stats = ["Speed","Acceleration","Altitude","Energy","Handling","Toughness","Boost","Training"];
const algo = window.createMountAlgorithms(stats);
const materialTiers = {
  2: {
    "Granite Ingot": { Energy: 5, Toughness: 10, cost: 1 },
    "Granite Gem": { Speed: 5, Energy: 2, Training: 8, cost: 1 },
    "Birch Wood": { Speed: 2, Acceleration: 8, Toughness: 5, cost: 1 },
    "Birch Paper": { Altitude: 10, Boost: 5, cost: 1 },
    "Barley String": { Acceleration: 2, Handling: 5, Boost: 8, cost: 1 },
    "Barley Grains": { Speed: 10, Altitude: 5, cost: 1 },
    "Trout Oil": { Altitude: 2, Handling: 8, Training: 5, cost: 1 },
    "Trout Meat": { Acceleration: 5, Energy: 10, cost: 1 }
  },
  3: {
    "Gold Ingot": { Energy: 5, Toughness: 12, cost: 1 },
    "Gold Gem": { Speed: 6, Energy: 3, Training: 9, cost: 1 },
    "Willow Wood": { Speed: 3, Acceleration: 9, Toughness: 6, cost: 1 },
    "Willow Paper": { Altitude: 12, Boost: 5, cost: 1 },
    "Oat String": { Acceleration: 3, Handling: 6, Boost: 9, cost: 1 },
    "Oat Grains": { Speed: 12, Altitude: 5, cost: 1 },
    "Salmon Oil": { Altitude: 3, Handling: 9, Training: 6, cost: 1 },
    "Salmon Meat": { Acceleration: 5, Energy: 12, cost: 1 }
  }
};
const limitValues = {Speed:20,Acceleration:1,Altitude:1,Energy:1,Handling:1,Toughness:1,Boost:1,Training:1};
const maxValues = {Speed:44,Acceleration:1,Altitude:1,Energy:1,Handling:1,Toughness:1,Boost:1,Training:1};
const r2 = algo.calculateOptimalFeed(limitValues,maxValues,materialTiers[2]);
const r3 = algo.calculateOptimalFeed(limitValues,maxValues,materialTiers[3]);
console.log('r2',r2);
console.log('r3',r3);
const t2 = Object.values(r2.usedItems||{}).reduce((a,b)=>a+b,0);
const t3 = Object.values(r3.usedItems||{}).reduce((a,b)=>a+b,0);
console.log({t2,t3});
