(function () {
const { ADVANCED_SLIDER_MAX, STATS } = window.APP_CONSTANTS;
const {
  getTierSoftOvershoot,
  loadMaterialTiers,
  materialToImageFile,
  pickTier,
  tierMinLevel
} = window.TierUtils;

const tbody = document.querySelector("#statTable tbody");
const outputElement = document.getElementById("output");
const defaultOutputHTML = "Fill in the table and click Calculate Optimal Materials.";
const nbtScanButton = document.getElementById("nbtScanButton");
const nbtModal = document.getElementById("nbtModal");
const nbtInput = document.getElementById("nbtInput");
const nbtSubmitButton = document.getElementById("nbtSubmitButton");
const nbtClearButton = document.getElementById("nbtClearButton");
const nbtCloseButton = document.getElementById("nbtCloseButton");
const missingMaxModal = document.getElementById("missingMaxModal");
const missingMaxMessage = document.getElementById("missingMaxMessage");
const missingMaxProceedButton = document.getElementById("missingMaxProceedButton");
const missingMaxCancelButton = document.getElementById("missingMaxCancelButton");
const missingMaxCloseButton = document.getElementById("missingMaxCloseButton");
const algoModeSelect = document.getElementById("algoModeSelect");
const trainingToggleInput = document.getElementById("trainingToggleInput");
const offUiToggleInput = document.getElementById("offUiToggleInput");
const offUiToggleWrap = document.getElementById("offUiToggleWrap");
const advancedToggle = document.getElementById("advancedToggle");
const advancedBody = document.getElementById("advancedBody");
const advancedStageSlider = document.getElementById("advancedStageSlider");
const advancedStageLabel = document.getElementById("advancedStageLabel");
const advancedMeta = document.getElementById("advancedMeta");
const advancedWarnings = document.getElementById("advancedWarnings");
const advancedDiff = document.getElementById("advancedDiff");

const algorithms = window.createMountAlgorithms(STATS);

let pendingParsedResult = null;
let advancedState = null;
let advancedEnabled = false;
let materialTiers = {};
let withTraining = false;
let useModernOffUi = offUiToggleInput ? offUiToggleInput.checked === true : false;
let hasCalculatedOutput = false;
let offTrainingPlanner = null;
let withTrainingPlanner = null;
let trainingCardIndex = 0;
let trainingCardCount = 0;

function getActiveTrainingPlanner() {
  return withTraining ? withTrainingPlanner : offTrainingPlanner;
}

function buildStatRows() {
  if (tbody.children.length > 0) {
    return;
  }

  STATS.forEach((stat) => {
    const row = tbody.insertRow();
    row.innerHTML = `
      <td id="label_${stat}">${stat}</td>
      <td><input type="number" id="current_${stat}" value="1" min="0"></td>
      <td><input type="number" id="limit_${stat}" value="10" min="0"></td>
      <td><input type="number" id="max_${stat}" value="30" min="0"></td>
    `;
  });
}

function openNbtModal() {
  nbtModal.classList.add("open");
  nbtModal.setAttribute("aria-hidden", "false");
  nbtInput.focus();
}

function closeNbtModal() {
  nbtModal.classList.remove("open");
  nbtModal.setAttribute("aria-hidden", "true");
}

function openMissingMaxModal(missingStats) {
  missingMaxMessage.textContent = `The parsed data did not include Max for: ${missingStats.join(", ")}. Proceed will use the default Max value already in the table.`;
  missingMaxModal.classList.add("open");
  missingMaxModal.setAttribute("aria-hidden", "false");
  missingMaxProceedButton.focus();
}

function closeMissingMaxModal() {
  missingMaxModal.classList.remove("open");
  missingMaxModal.setAttribute("aria-hidden", "true");
}

function applyNbtValues(parsedStats, options = {}) {
  let updated = 0;
  const useDefaultMaxForMissing = options.useDefaultMaxForMissing === true;
  const altitudeLabel = document.getElementById("label_Altitude");

  if (altitudeLabel) {
    altitudeLabel.textContent = "Altitude";
  }

  STATS.forEach((stat) => {
    const values = parsedStats[stat];
    if (!values) return;

    const currentInput = document.getElementById(`current_${stat}`);
    const limitInput = document.getElementById(`limit_${stat}`);
    const maxInput = document.getElementById(`max_${stat}`);

    currentInput.value = values.current;
    limitInput.value = values.limit;
    if (Number.isFinite(values.max) && !(values.inferredMax && useDefaultMaxForMissing)) {
      maxInput.value = values.max;
    }

    if (stat === "Altitude" && altitudeLabel) {
      altitudeLabel.textContent = values.sourceLabel === "Jump Height" ? "Jump Height" : "Altitude";
    }

    updated += 1;
  });

  return updated;
}

function parseNbtStats(nbtText) {
  const parsed = {};
  const missingMaxStats = [];
  const text = nbtText
    .replace(/\\\"/g, "\"")
    .replace(/\r?\n/g, " ");

  function parseRowForAlias(sourceText, alias) {
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const directRegex = new RegExp(
      `text:"${escapedAlias}"[\\s\\S]{0,260}?text:"(\\d{1,3})"[\\s\\S]{0,200}?text:"\\/(\\d{1,3})(?:\\/(\\d{1,3}))?"`
    );

    const directMatch = sourceText.match(directRegex);
    if (directMatch) {
      const limitValue = Number.parseInt(directMatch[2], 10);
      const hasMax = !!directMatch[3];
      return {
        current: Number.parseInt(directMatch[1], 10),
        limit: limitValue,
        max: hasMax ? Number.parseInt(directMatch[3], 10) : limitValue,
        inferredMax: !hasMax,
        sourceLabel: alias
      };
    }

    const marker = `text:"${alias}"`;
    const idx = sourceText.indexOf(marker);
    if (idx === -1) return null;

    const scopeWindow = sourceText.slice(idx, idx + 1200);
    const currentMatch = scopeWindow.match(/text:"(\d{1,3})"/);
    if (!currentMatch) return null;

    const tripletMatch = scopeWindow.match(/text:"\/(\d{1,3})\/(\d{1,3})"/);
    if (tripletMatch) {
      return {
        current: Number.parseInt(currentMatch[1], 10),
        limit: Number.parseInt(tripletMatch[1], 10),
        max: Number.parseInt(tripletMatch[2], 10),
        inferredMax: false,
        sourceLabel: alias
      };
    }

    const pairMatch = scopeWindow.match(/text:"\/(\d{1,3})"/);
    if (pairMatch) {
      const limitOnly = Number.parseInt(pairMatch[1], 10);
      return {
        current: Number.parseInt(currentMatch[1], 10),
        limit: limitOnly,
        max: limitOnly,
        inferredMax: true,
        sourceLabel: alias
      };
    }

    return null;
  }

  STATS.forEach((stat) => {
    const aliases = stat === "Altitude"
      ? ["Altitude", "Jump Height"]
      : [stat];

    let row = null;

    aliases.some((alias) => {
      row = parseRowForAlias(text, alias);
      return !!row;
    });

    if (!row) return;

    parsed[stat] = row;
    if (row.inferredMax) {
      missingMaxStats.push(stat);
    }
  });

  const rows = [];
  const rowRegex = /text:"(\d{1,3})"[\s\S]{0,140}?text:"\/(\d{1,3})(?:\/(\d{1,3}))?"/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(text)) !== null) {
    const limitValue = Number.parseInt(rowMatch[2], 10);
    const maxValue = rowMatch[3] ? Number.parseInt(rowMatch[3], 10) : limitValue;
    rows.push({
      current: Number.parseInt(rowMatch[1], 10),
      limit: limitValue,
      max: maxValue,
      inferredMax: !rowMatch[3]
    });
  }

  STATS.forEach((stat, index) => {
    if (!parsed[stat] && rows[index]) {
      parsed[stat] = rows[index];
      if (rows[index].inferredMax) {
        missingMaxStats.push(stat);
      }
    }
  });

  return {
    parsed,
    missingMaxStats: [...new Set(missingMaxStats)]
  };
}

function getResultTotalItems(result) {
  if (!result || !result.feasible) return null;
  if (Number.isFinite(result.totalItems)) return result.totalItems;
  return Object.values(result.usedItems || {}).reduce((sum, qty) => sum + qty, 0);
}

function extractItemCounts(result, activeMaterials) {
  const itemCounts = {};

  Object.keys(activeMaterials).forEach((material) => {
    const qty = result.usedItems
      ? result.usedItems[material]
      : (result[material] || (result.counts ? result.counts[material] : 0));

    if (qty && qty > 0) {
      itemCounts[material] = qty;
    }
  });

  return itemCounts;
}

function getFeedingMinutesPerMaterial(averageLimit) {
  if (averageLimit >= 20) return 360;
  if (averageLimit >= 19) return 300;
  if (averageLimit >= 18) return 240;
  if (averageLimit >= 17) return 180;
  if (averageLimit >= 16) return 120;
  if (averageLimit >= 15) return 60;
  if (averageLimit >= 14) return 30;
  if (averageLimit >= 13) return 15;
  if (averageLimit >= 12) return 5;
  return 1;
}

function formatDuration(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return parts.join(" ");
}

function buildFeedSequence(itemCounts, activeMaterials) {
  const orderedMaterials = Object.keys(itemCounts)
    .filter((material) => Number(itemCounts[material] || 0) > 0)
    .map((material) => {
      const totalGain = STATS.reduce((sum, stat) => sum + Number(activeMaterials[material] && activeMaterials[material][stat] || 0), 0);
      return {
        material,
        totalGain
      };
    })
    .sort((a, b) => {
      if (a.totalGain !== b.totalGain) return a.totalGain - b.totalGain;
      return a.material.localeCompare(b.material);
    });

  const sequence = [];
  orderedMaterials.forEach((entry) => {
    const qty = Number(itemCounts[entry.material] || 0);
    for (let i = 0; i < qty; i += 1) {
      sequence.push(entry.material);
    }
  });

  return sequence;
}

function calculateDynamicFeedingTime(startLimits, itemCounts, activeMaterials, maxValues) {
  const sequence = buildFeedSequence(itemCounts, activeMaterials);

  const running = { ...startLimits };
  let totalMinutes = 0;
  let firstPerFeedMinutes = null;
  let lastPerFeedMinutes = null;

  sequence.forEach((material) => {
    const averageLimit = Math.ceil(
      STATS.reduce((sum, stat) => sum + Number(running[stat] || 0), 0) / STATS.length
    );
    const perFeedMinutes = getFeedingMinutesPerMaterial(averageLimit);

    if (firstPerFeedMinutes === null) {
      firstPerFeedMinutes = perFeedMinutes;
    }
    lastPerFeedMinutes = perFeedMinutes;
    totalMinutes += perFeedMinutes;

    STATS.forEach((stat) => {
      running[stat] = Number(running[stat] || 0) + Number(activeMaterials[material][stat] || 0);
    });
  });

  if (firstPerFeedMinutes === null) firstPerFeedMinutes = 0;
  if (lastPerFeedMinutes === null) lastPerFeedMinutes = 0;

  return {
    totalMinutes,
    firstPerFeedMinutes,
    lastPerFeedMinutes
  };
}

function buildFeedingTimelineFromAdvancedTimeline(timeline) {
  const cumulativeMinutes = [0];
  const perFeedMinutes = [0];

  for (let stage = 1; stage < timeline.length; stage += 1) {
    const beforeLimits = timeline[stage - 1].limits;
    const averageLimit = Math.ceil(
      STATS.reduce((sum, stat) => sum + Number(beforeLimits[stat] || 0), 0) / STATS.length
    );
    const minutes = getFeedingMinutesPerMaterial(averageLimit);

    perFeedMinutes.push(minutes);
    cumulativeMinutes.push(cumulativeMinutes[stage - 1] + minutes);
  }

  return {
    cumulativeMinutes,
    perFeedMinutes
  };
}

function formatItemStatGains(itemStats) {
  return STATS
    .map((stat) => {
      const value = Number(itemStats[stat] || 0);
      if (!value) return "";
      return `${stat} +${value}`;
    })
    .filter(Boolean)
    .join(", ");
}

function parseTrainingCardTitle(stepText) {
  if (!stepText) return "Train your mount";

  const match = String(stepText).match(/raise\s+(.+?)\s+to\s+(\d+)\s+for\s+Tier\s+(\d+)/i);
  if (match) {
    return `Train your mount's ${match[1]} to ${match[2]} for Tier ${match[3]}`;
  }

  return String(stepText).replace(/^Use\s+/i, "Train ").replace(/\.$/, "");
}

function buildTrainingCardGroups(steps) {
  const groups = [];

  for (let index = 0; index < steps.length; index += 2) {
    groups.push(steps.slice(index, index + 2));
  }

  return groups;
}

function buildTrainingCardStepsHtml(cardGroups, cardIndex) {
  const group = cardGroups[cardIndex] || [];
  const eatStep = group.find((step) => step && step.type === "Eat") || group[group.length - 1] || null;
  const title = parseTrainingCardTitle(eatStep && eatStep.text ? eatStep.text : group[0] && group[0].text);
  const feedRows = eatStep && Array.isArray(eatStep.items)
    ? eatStep.items.map((item) => {
      const gains = formatItemStatGains(item.stats || {});
      return `
        <li class="training-feed-item">
          <span class="training-feed-main">${item.qty}x ${item.name}</span>
          <span class="training-feed-stats">${gains}</span>
        </li>
      `;
    }).join("")
    : "";

  const feedContent = feedRows
    ? `<ul class="training-feed-list">${feedRows}</ul>`
    : `<span class="training-feed-empty">No materials needed.</span>`;

  const trainInstruction = cardIndex >= cardGroups.length - 1
    ? "The best material is on hand right now :D"
    : title.replace(/\s+for\s+Tier\s+\d+\b/i, "");
  const trainSuffix = cardIndex >= cardGroups.length - 1 ? "" : " for better material.";

  return `
    <li><strong class="training-card-step-label">Train</strong>: ${trainInstruction}${trainSuffix}</li>
    <li><strong class="training-card-step-label">Feed</strong>: ${feedContent}</li>
  `;
}

function renderTrainingGuide(plan) {
  const steps = plan && Array.isArray(plan.steps) ? plan.steps : [];
  const displaySteps = steps.filter((step) => {
    if (!step) return false;
    const text = String(step.text || "");
    if ((step.type || "").toLowerCase() === "plan") return false;
    if (/switch to tier\s+\d+\s+breeding-off optimization/i.test(text)) return false;
    if (/switch to other algo/i.test(text)) return false;
    return true;
  });
  if (displaySteps.length === 0) {
    return "<p class=\"note\">No training steps generated.</p>";
  }

  const cardGroups = buildTrainingCardGroups(displaySteps);
  const activeCardIndex = Math.max(0, Math.min(trainingCardIndex, Math.max(0, cardGroups.length - 1)));
  trainingCardCount = cardGroups.length;
  trainingCardIndex = activeCardIndex;

  const totalMaterialsUsed = Number(plan && plan.totalMaterialsUsed) || 0;
  const totalFeedingMinutes = Number(plan && plan.totalFeedingMinutes) || 0;
  const groupSteps = buildTrainingCardStepsHtml(cardGroups, activeCardIndex);

  const navDisabledPrev = activeCardIndex <= 0 ? "disabled" : "";
  const navDisabledNext = activeCardIndex >= cardGroups.length - 1 ? "disabled" : "";

  return `
    <div class="training-card-deck" data-card-count="${cardGroups.length}" data-card-index="${activeCardIndex}">
      <div class="training-card-stage">
        <article class="training-card" data-card-index="${activeCardIndex}">
          <div class="training-card-head">
            <h4 class="training-card-title">Step ${activeCardIndex + 1}</h4>
            <div class="training-card-head-nav">
              <button class="ghost training-card-button" type="button" data-training-card-action="prev" ${navDisabledPrev}>Prev</button>
              <button class="ghost training-card-button" type="button" data-training-card-action="next" ${navDisabledNext}>Next</button>
            </div>
          </div>
          <ol class="training-card-steps">${groupSteps}</ol>
        </article>
      </div>
      <div class="training-card-nav">
        <span class="training-card-count">${activeCardIndex + 1} / ${cardGroups.length}</span>
      </div>
    </div>
    <p><strong>Total materials used: ${totalMaterialsUsed}</strong></p>
    <p><strong>Feeding Time: ${formatDuration(totalFeedingMinutes)} total (not counting training)</strong></p>
  `;
}

function renderOffModeGuide(offPlan, activeMaterials, activeTier) {
  const itemCounts = offPlan && offPlan.itemCounts ? offPlan.itemCounts : {};
  const feedRows = Object.keys(itemCounts)
    .filter((material) => Number(itemCounts[material] || 0) > 0)
    .map((material) => {
      const gains = formatItemStatGains(activeMaterials[material] || {});
      return `
        <li class="training-feed-item">
          <span class="training-feed-main">${itemCounts[material]}x ${material}</span>
          <span class="training-feed-stats">${gains}</span>
        </li>
      `;
    })
    .join("");

  const feedContent = feedRows
    ? `<ul class="training-feed-list">${feedRows}</ul>`
    : `<span class="training-feed-empty">No materials needed.</span>`;

  const tipText = offPlan && offPlan.tip
    ? `Tip: train to level ${offPlan.tip.threshold} for fewer items.`
    : "";

  return `
    <div class="training-card-deck off-mode-card">
      <div class="training-card-stage">
        <article class="training-card">
          <div class="training-card-head off-mode-head">
            <h4 class="training-card-title">Using Tier ${activeTier} materials</h4>
            <span class="off-mode-tip">${tipText}</span>
          </div>
          <ol class="training-card-steps">
            <li><strong class="training-card-step-label">Feeding materials</strong>: ${feedContent}</li>
          </ol>
        </article>
      </div>
    </div>
  `;
}

function updateTrainingCardDeck(direction) {
  if (!Number.isFinite(trainingCardCount) || trainingCardCount <= 1) return;

  const nextIndex = Math.max(0, Math.min(trainingCardCount - 1, trainingCardIndex + direction));
  if (nextIndex === trainingCardIndex) return;

  trainingCardIndex = nextIndex;
  calculate({ preserveTrainingCardIndex: true });
}

function calculateFeedByMode(currentStats, targetStats, itemDatabase, mode) {
  if (mode === "best-safe-90") {
    return algorithms.calculateBestSafeFeedWithMinimum(currentStats, targetStats, itemDatabase, {
      softOvershoot: 3,
      maxDepth: 15,
      minCoverageRatio: 0.9,
      perStatFloorRatio: 0.8,
      targetCoverageRatio: 0.9,
      efficiencyFloor: 3
    });
  }

  if (mode === "best-safe-100") {
    return algorithms.calculateBestSafeFeedWithMinimum(currentStats, targetStats, itemDatabase, {
      softOvershoot: 3,
      maxDepth: 20,
      minCoverageRatio: 1.0,
      perStatFloorRatio: 0.75,
      targetCoverageRatio: 1.0,
      efficiencyFloor: 3
    });
  }

  return algorithms.calculateOptimalFeed(currentStats, targetStats, itemDatabase);
}

function calculateFeedForTier(currentStats, targetStats, itemDatabase, mode, tier) {
  if (mode !== "best-safe-90" && mode !== "best-safe-100") {
    return calculateFeedByMode(currentStats, targetStats, itemDatabase, mode);
  }

  return algorithms.calculateBestSafeFeedWithMinimum(currentStats, targetStats, itemDatabase, {
    softOvershoot: getTierSoftOvershoot(tier),
    maxDepth: mode === "best-safe-100" ? 20 : 15,
    minCoverageRatio: mode === "best-safe-100" ? 1.0 : 0.9,
    perStatFloorRatio: mode === "best-safe-100" ? 0.75 : 0.8,
    targetCoverageRatio: mode === "best-safe-100" ? 1.0 : 0.9,
    efficiencyFloor: 3
  });
}

function createAdvancedTimeline(startLimits, itemCounts, activeMaterials, maxValues) {
  const sequence = buildFeedSequence(itemCounts, activeMaterials);

  const zeroOvershoot = {};
  STATS.forEach((stat) => {
    zeroOvershoot[stat] = 0;
  });

  const timeline = [{ limits: { ...startLimits }, appliedMaterial: null, overshootTotals: { ...zeroOvershoot } }];
  let running = { ...startLimits };
  let runningOvershoot = { ...zeroOvershoot };

  sequence.forEach((material) => {
    const next = { ...running };
    const nextOvershoot = { ...runningOvershoot };
    STATS.forEach((stat) => {
      const beforeValue = Number(running[stat] || 0);
      const gain = Number(activeMaterials[material][stat] || 0);
      const afterValue = beforeValue + gain;
      next[stat] = afterValue;

      const cap = Number(maxValues && maxValues[stat]);
      if (Number.isFinite(cap)) {
        const beforeOver = Math.max(0, beforeValue - cap);
        const afterOver = Math.max(0, afterValue - cap);
        nextOvershoot[stat] = Number(nextOvershoot[stat] || 0) + Math.max(0, afterOver - beforeOver);
      }
    });
    timeline.push({ limits: next, appliedMaterial: material, overshootTotals: nextOvershoot });
    running = next;
    runningOvershoot = nextOvershoot;
  });

  return timeline;
}

function updateAdvancedSliderVisual() {
  const min = Number.parseFloat(advancedStageSlider.min || "0");
  const max = Number.parseFloat(advancedStageSlider.max || "100");
  const value = Number.parseFloat(advancedStageSlider.value || "0");

  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : 100;
  const safeValue = Number.isFinite(value) ? value : safeMin;
  const range = safeMax - safeMin;
  const progress = range > 0 ? ((safeValue - safeMin) / range) * 100 : 0;

  advancedStageSlider.style.setProperty("--slider-progress", `${Math.max(0, Math.min(100, progress))}%`);
}

function renderAdvancedStage() {
  advancedBody.hidden = !(advancedEnabled && !!advancedState);

  if (!advancedState) {
    advancedStageSlider.value = "0";
    advancedStageSlider.min = "0";
    advancedStageSlider.max = String(ADVANCED_SLIDER_MAX);
    advancedStageSlider.disabled = true;
    advancedStageLabel.textContent = "Stage 0 / 0";
    advancedMeta.textContent = "Run calculate to view stage-by-stage changes.";
    advancedWarnings.innerHTML = "";
    advancedDiff.innerHTML = "";
    updateAdvancedSliderVisual();
    return;
  }

  const maxStage = Math.max(0, advancedState.timeline.length - 1);
  let sliderValue = Number.parseFloat(advancedStageSlider.value);
  if (!Number.isFinite(sliderValue)) sliderValue = 0;
  sliderValue = Math.max(0, Math.min(ADVANCED_SLIDER_MAX, sliderValue));
  const stage = maxStage > 0
    ? Math.round((sliderValue / ADVANCED_SLIDER_MAX) * maxStage)
    : 0;

  advancedStageSlider.min = "0";
  advancedStageSlider.max = String(ADVANCED_SLIDER_MAX);
  advancedStageSlider.disabled = maxStage === 0;
  updateAdvancedSliderVisual();
  advancedStageLabel.textContent = `Stage ${stage} / ${maxStage}`;

  const after = advancedState.timeline[stage];
  const before = stage > 0 ? advancedState.timeline[stage - 1] : advancedState.timeline[0];
  const elapsedMinutes = Number(
    advancedState.feedingTimeline
      && advancedState.feedingTimeline.cumulativeMinutes
      && advancedState.feedingTimeline.cumulativeMinutes[stage]
      ? advancedState.feedingTimeline.cumulativeMinutes[stage]
      : 0
  );
  const stageFeedMinutes = Number(
    advancedState.feedingTimeline
      && advancedState.feedingTimeline.perFeedMinutes
      && advancedState.feedingTimeline.perFeedMinutes[stage]
      ? advancedState.feedingTimeline.perFeedMinutes[stage]
      : 0
  );

  if (stage === 0) {
    advancedMeta.textContent = "Before applying materials (baseline).";
  } else {
    advancedMeta.textContent = `Applied at this stage: ${after.appliedMaterial}`;
  }

  let rowsHtml = "";
  STATS.forEach((stat) => {
    const beforeValue = Number(before.limits[stat] || 0);
    const afterValue = Number(after.limits[stat] || 0);
    const maxValue = Number(advancedState.maxValues[stat] || 0);
    const beforeDisplay = Math.min(beforeValue, maxValue);
    const afterDisplay = Math.min(afterValue, maxValue);
    const delta = afterValue - beforeValue;
    const deltaText = delta > 0 ? `+${delta}` : `${delta}`;
    const overshoot = Number(after.overshootTotals && after.overshootTotals[stat]);
    const safeOvershoot = Number.isFinite(overshoot) ? overshoot : Math.max(0, afterValue - maxValue);
    const overshootText = safeOvershoot > 0 ? `+${safeOvershoot}` : "0";
    rowsHtml += `<tr><td class="stat-col">${stat}</td><td class="before-col">${beforeDisplay}/${maxValue}</td><td class="after-col">${afterDisplay}/${maxValue}</td><td class="change-col">${deltaText}</td><td class="overshoot-col">${overshootText}</td></tr>`;
  });

  const advancedTimerHtml = stage > 0
    ? `<p class="advanced-timer"><span class="advanced-timer-left">Time needed: ${formatDuration(stageFeedMinutes)}</span><span class="advanced-timer-right">Total time: ${formatDuration(elapsedMinutes)}</span></p>`
    : `<p class="advanced-timer"><span class="advanced-timer-left">Time needed: baseline</span><span class="advanced-timer-right">Total time: ${formatDuration(elapsedMinutes)}</span></p>`;

  advancedDiff.innerHTML = `
    ${advancedTimerHtml}
    <table class="advanced-table">
      <thead>
        <tr>
          <th class="stat-col">Stat</th>
          <th class="before-col">Before</th>
          <th class="after-col">After</th>
          <th class="change-col">Change</th>
          <th class="overshoot-col">Overshoot</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}

function calculate(options = {}) {
  const preserveTrainingCardIndex = options.preserveTrainingCardIndex === true;
  hasCalculatedOutput = false;
  let highestCurrent = 0;
  let highestLimit = 0;
  const currentValues = {};
  const deficits = {};
  const notes = [];
  const limitValues = {};
  const maxValues = {};

  STATS.forEach((stat) => {
    const currentInput = document.getElementById(`current_${stat}`);
    const limitInput = document.getElementById(`limit_${stat}`);
    const maxInput = document.getElementById(`max_${stat}`);

    const current = Number.parseInt(currentInput.value, 10) || 0;
    const limit = Number.parseInt(limitInput.value, 10) || 0;
    const maxValue = Number.parseInt(maxInput.value, 10) || 0;

    if (current > highestCurrent) highestCurrent = current;
    if (limit > highestLimit) highestLimit = limit;

    currentValues[stat] = current;
    limitValues[stat] = limit;
    maxValues[stat] = maxValue;
    deficits[stat] = Math.max(0, maxValue - limit);
  });

  const activeTier = pickTier(highestCurrent);
  const activeMaterials = materialTiers[activeTier];

  if (withTraining && (!materialTiers || Object.keys(materialTiers).length === 0)) {
    outputElement.innerHTML = "Material tier data is missing.";
    return;
  }

  if (!withTraining && !activeMaterials) {
    outputElement.innerHTML = `Material data for Tier ${activeTier} is missing.`;
    return;
  }

  let hasAnyDeficit = false;

  STATS.forEach((stat) => {
    if (deficits[stat] > 0) {
      hasAnyDeficit = true;
    }
  });

  if (!hasAnyDeficit) {
    outputElement.innerHTML = "<p class=\"ok\">No materials needed. Your limit stats already meet max values.</p>";
    return;
  }

  const algoMode = algoModeSelect.value;
  const planner = getActiveTrainingPlanner();
  let tierHeaderHTML = withTraining ? "" : `<p><strong>Using Tier ${activeTier} materials</strong></p>`;
  let outputHTML = "";
  let trailingNoteHTML = "";

  advancedState = null;
  renderAdvancedStage();

  if (withTraining) {
    const trainingPlan = planner.plan({
      currentValues,
      limitValues,
      maxValues,
      activeTier,
      algoMode,
      materialTiers
    });

    if (trainingPlan && trainingPlan.feasible) {
      if (!preserveTrainingCardIndex) {
        trainingCardIndex = 0;
      }
      trainingCardCount = Array.isArray(trainingPlan.steps) ? Math.ceil(trainingPlan.steps.length / 2) : 0;
      outputHTML += renderTrainingGuide(trainingPlan);

      if (Array.isArray(trainingPlan.advancedTimeline) && trainingPlan.advancedTimeline.length > 0) {
        advancedState = {
          timeline: trainingPlan.advancedTimeline,
          feedingTimeline: buildFeedingTimelineFromAdvancedTimeline(trainingPlan.advancedTimeline),
          maxValues: { ...maxValues },
          coverageSummary: trainingPlan.stage2 && trainingPlan.stage2.coverageSummary
            ? trainingPlan.stage2.coverageSummary
            : ""
        };
        advancedStageSlider.value = String(ADVANCED_SLIDER_MAX);
        renderAdvancedStage();
      } else if (trainingPlan.stage2 && Array.isArray(trainingPlan.stage2.advancedTimeline)) {
        advancedState = {
          timeline: trainingPlan.stage2.advancedTimeline,
          feedingTimeline: trainingPlan.stage2.feedingTimeline,
          maxValues: { ...maxValues },
          coverageSummary: trainingPlan.stage2.coverageSummary
        };
        advancedStageSlider.value = String(ADVANCED_SLIDER_MAX);
        renderAdvancedStage();
      }
    } else {
      outputHTML += `Selected algorithm could not find a useful combination in training mode. ${trainingPlan && trainingPlan.reason ? trainingPlan.reason : "No material can raise Stats"}`;
      advancedState = null;
      renderAdvancedStage();
    }
  } else {
    const offPlan = planner.plan({
      limitValues,
      maxValues,
      activeTier,
      activeMaterials,
      algoMode,
      materialTiers,
      highestLimit,
      highestCurrent
    });

    if (offPlan && offPlan.feasible) {
      const itemCounts = offPlan.itemCounts;
      if (useModernOffUi) {
        outputHTML += renderOffModeGuide(offPlan, activeMaterials, activeTier);
      } else {
        let totalItems = 0;
        let rowsHTML = "";

        const formatRaises = (materialStats) => {
          return STATS
            .map((stat) => {
              const value = Number(materialStats[stat] || 0);
              if (!value) return "";
              return `${stat} (+${value})`;
            })
            .filter(Boolean)
            .join(", ");
        };

        Object.keys(activeMaterials).forEach((material) => {
          const qty = itemCounts[material] || 0;
          if (qty && qty > 0) {
            const imageFile = materialToImageFile(material);
            const raisesText = formatRaises(activeMaterials[material]);
            const pointsPerFeed = STATS.reduce((sum, stat) => sum + Number(activeMaterials[material][stat] || 0), 0);
            const totalPointsAdded = pointsPerFeed * qty;

            rowsHTML += `
              <tr>
                <td class="material-cell">
                  <span class="material-row">
                    <img class="material-icon" src="img/mats/${imageFile}" alt="${material}" onerror="this.style.display='none'">
                    <span class="material-name">${material}</span>
                  </span>
                </td>
                <td>${raisesText}</td>
                <td class="numeric-cell">${qty}</td>
                <td class="numeric-cell">${totalPointsAdded}</td>
              </tr>
            `;
            totalItems += qty;
          }
        });

        outputHTML += `
          <div class="result-table-wrap">
            <table class="result-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Stats given</th>
                  <th>Material Quantity</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>${rowsHTML}</tbody>
            </table>
          </div>
        `;
      }

      const currentTierTotalItems = Number.isFinite(offPlan.currentTierTotalItems)
        ? offPlan.currentTierTotalItems
        : Object.values(itemCounts || {}).reduce((sum, qty) => sum + Number(qty || 0), 0);
    outputHTML += `<p><strong>Total materials needed: ${currentTierTotalItems}</strong></p>`;

      const feedingTime = offPlan.feedingTime;
    outputHTML += `<p><strong>Feeding Time: ${formatDuration(feedingTime.totalMinutes)} total (not counting training)</strong></p>`;

      advancedState = {
      timeline: offPlan.advancedTimeline,
      feedingTimeline: offPlan.feedingTimeline,
      maxValues: { ...maxValues },
      coverageSummary: offPlan.coverageSummary
    };
    advancedStageSlider.value = String(ADVANCED_SLIDER_MAX);
    renderAdvancedStage();

      if (offPlan.tip && !useModernOffUi) {
        const tipHtml = `<p class="note tip-note">Tip: train to level ${offPlan.tip.threshold} (Tier ${offPlan.tip.tier}) for fewer items: ${offPlan.tip.totalItems} vs ${offPlan.tip.currentTierTotalItems}.</p>`;
        tierHeaderHTML += tipHtml;
      }
    } else {
      outputHTML += `Selected algorithm could not find a useful combination in this tier. ${offPlan && offPlan.reason ? offPlan.reason : ""}`;
      advancedState = null;
      renderAdvancedStage();
    }
  }

  outputHTML = tierHeaderHTML + outputHTML;

  if (highestCurrent > 115) {
    notes.push("Current level is above 115. Tier 14 is used as fallback until higher-tier data is added.");
  }

  if (notes.length > 0) {
    outputHTML += `<p class="note">${notes.join("<br>")}</p>`;
  }

  outputHTML += trailingNoteHTML;

  outputElement.innerHTML = outputHTML;
  hasCalculatedOutput = true;
}

function submitNbtScan() {
  const text = nbtInput.value.trim();
  if (!text) {
    outputElement.innerHTML = "NBT input is empty. Paste the item NBT text and submit.";
    return;
  }

  const parsedResult = parseNbtStats(text);
  const count = Object.keys(parsedResult.parsed).length;

  if (count === 0) {
    outputElement.innerHTML = "NBT scan could not find stat rows. Paste the full item NBT text and try again.";
    return;
  }

  if (parsedResult.missingMaxStats.length > 0) {
    pendingParsedResult = parsedResult;
    closeNbtModal();
    openMissingMaxModal(parsedResult.missingMaxStats);
    return;
  }

  applyNbtValues(parsedResult.parsed);

  const missing = STATS.filter((stat) => !parsedResult.parsed[stat]);
  if (missing.length > 0) {
    outputElement.innerHTML = `NBT scan updated ${count} stats. Missing: ${missing.join(", ")}.`;
  } else {
    outputElement.innerHTML = `NBT scan updated all ${count} stats. You can calculate now.`;
  }

  closeNbtModal();
  calculate();
}

function cancelMissingMaxFlow() {
  pendingParsedResult = null;
  closeMissingMaxModal();
}

function syncOffUiToggleState() {
  if (!offUiToggleInput) {
    return;
  }

  if (withTraining) {
    offUiToggleInput.checked = true;
    offUiToggleInput.disabled = true;
    if (offUiToggleWrap) {
      offUiToggleWrap.classList.add("is-locked");
    }
    useModernOffUi = true;
  } else {
    offUiToggleInput.disabled = false;
    if (offUiToggleWrap) {
      offUiToggleWrap.classList.remove("is-locked");
    }
  }
}

function resetCalculationResult() {
  hasCalculatedOutput = false;
  advancedState = null;
  trainingCardIndex = 0;
  trainingCardCount = 0;
  outputElement.innerHTML = defaultOutputHTML;
  renderAdvancedStage();
}

function bindEvents() {
  document.getElementById("calcButton").addEventListener("click", calculate);
  nbtScanButton.addEventListener("click", openNbtModal);
  nbtSubmitButton.addEventListener("click", submitNbtScan);
  trainingToggleInput.addEventListener("change", () => {
    withTraining = trainingToggleInput.checked === true;
    if (offUiToggleWrap) {
      offUiToggleWrap.hidden = withTraining;
    }
    syncOffUiToggleState();
    resetCalculationResult();
  });
  if (offUiToggleInput) {
    offUiToggleInput.addEventListener("change", () => {
      useModernOffUi = offUiToggleInput.checked === true;
      if (hasCalculatedOutput) {
        calculate({ preserveTrainingCardIndex: true });
      }
    });
  }
  nbtClearButton.addEventListener("click", () => {
    nbtInput.value = "";
    nbtInput.focus();
  });
  nbtCloseButton.addEventListener("click", closeNbtModal);

  outputElement.addEventListener("click", (event) => {
    const button = event.target.closest("[data-training-card-action]");
    if (!button || !outputElement.contains(button)) return;

    const action = button.getAttribute("data-training-card-action");
    if (action === "prev") {
      updateTrainingCardDeck(-1);
    }
    if (action === "next") {
      updateTrainingCardDeck(1);
    }
  });

  missingMaxProceedButton.addEventListener("click", () => {
    if (!pendingParsedResult) {
      closeMissingMaxModal();
      return;
    }

    const count = applyNbtValues(pendingParsedResult.parsed, { useDefaultMaxForMissing: true });
    const missing = STATS.filter((stat) => !pendingParsedResult.parsed[stat]);

    if (missing.length > 0) {
      outputElement.innerHTML = `NBT scan updated ${count} stats. Missing: ${missing.join(", ")}.`;
    } else {
      outputElement.innerHTML = `NBT scan updated all ${count} stats. Missing Max values were left at default table values.`;
    }

    pendingParsedResult = null;
    closeMissingMaxModal();
    calculate();
  });

  missingMaxCancelButton.addEventListener("click", cancelMissingMaxFlow);
  missingMaxCloseButton.addEventListener("click", cancelMissingMaxFlow);

  nbtModal.addEventListener("click", (event) => {
    if (event.target === nbtModal) {
      closeNbtModal();
    }
  });

  missingMaxModal.addEventListener("click", (event) => {
    if (event.target === missingMaxModal) {
      cancelMissingMaxFlow();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && missingMaxModal.classList.contains("open")) {
      cancelMissingMaxFlow();
      return;
    }

    if (event.key === "Escape" && nbtModal.classList.contains("open")) {
      closeNbtModal();
    }
  });

  advancedToggle.addEventListener("click", () => {
    advancedEnabled = !advancedEnabled;
    advancedToggle.setAttribute("aria-expanded", advancedEnabled ? "true" : "false");
    advancedToggle.textContent = advancedEnabled ? "Advanced (On)" : "Advanced (Off)";
    renderAdvancedStage();
  });

  advancedStageSlider.addEventListener("input", () => {
    renderAdvancedStage();
  });
}

async function initialize() {
  offTrainingPlanner = window.createOffTrainingPlanner({
    STATS,
    calculateFeedForTier,
    extractItemCounts,
    getResultTotalItems,
    calculateDynamicFeedingTime,
    createAdvancedTimeline,
    buildFeedingTimelineFromAdvancedTimeline,
    tierMinLevel
  });
  withTrainingPlanner = window.createWithTrainingPlanner({
    STATS,
    offTrainingPlanner,
    pickTier,
    tierMinLevel
  });
  withTraining = trainingToggleInput.checked === true;
  if (offUiToggleWrap) {
    offUiToggleWrap.hidden = withTraining;
  }
  syncOffUiToggleState();

  buildStatRows();
  bindEvents();

  try {
    materialTiers = await loadMaterialTiers();
  } catch (error) {
    outputElement.innerHTML = `Failed to load material data. ${error instanceof Error ? error.message : ""}`;
  }
}

initialize();
})();
