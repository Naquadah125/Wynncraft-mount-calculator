function pickTier(highestCurrent) {
  if (highestCurrent < 10) return 1;
  if (highestCurrent < 20) return 2;
  if (highestCurrent < 30) return 3;
  if (highestCurrent < 40) return 4;
  if (highestCurrent < 50) return 5;
  if (highestCurrent < 60) return 6;
  if (highestCurrent < 70) return 7;
  if (highestCurrent < 80) return 8;
  if (highestCurrent < 90) return 9;
  if (highestCurrent < 100) return 10;
  if (highestCurrent < 105) return 11;
  if (highestCurrent < 110) return 12;
  if (highestCurrent < 115) return 13;
  return 14;
}

function tierMinLevel(tier) {
  if (tier <= 1) return 0;
  if (tier === 2) return 10;
  if (tier === 3) return 20;
  if (tier === 4) return 30;
  if (tier === 5) return 40;
  if (tier === 6) return 50;
  if (tier === 7) return 60;
  if (tier === 8) return 70;
  if (tier === 9) return 80;
  if (tier === 10) return 90;
  if (tier === 11) return 100;
  if (tier === 12) return 105;
  if (tier === 13) return 110;
  return 115;
}

function materialToImageFile(materialName) {
  return materialName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "_") + ".jpg";
}

function getTierSoftOvershoot(tier) {
  return Math.max(3, tier + 2);
}

async function loadMaterialTiers() {
  if (window.location.protocol === "file:") {
    if (window.MATERIAL_TIERS_FALLBACK) {
      return window.MATERIAL_TIERS_FALLBACK;
    }
    throw new Error("Local file mode needs js/material-tiers-fallback.js loaded.");
  }

  const response = await fetch("data/material-tiers.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load tiers JSON: " + response.status);
  }
  return response.json();
}

window.TierUtils = {
  pickTier,
  tierMinLevel,
  materialToImageFile,
  getTierSoftOvershoot,
  loadMaterialTiers
};
