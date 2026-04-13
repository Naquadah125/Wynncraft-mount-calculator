(function () {
  function createOffTrainingPlanner(deps) {
    const {
      STATS,
      calculateFeedForTier,
      extractItemCounts,
      getResultTotalItems,
      calculateDynamicFeedingTime,
      createAdvancedTimeline,
      buildFeedingTimelineFromAdvancedTimeline,
      tierMinLevel
    } = deps;

    function buildCoverageSummary(result, algoMode) {
      if (algoMode !== "best-safe-90" && algoMode !== "best-safe-100") {
        return "";
      }

      const totalCoveragePct = Number.isFinite(result.totalCoverageRatio)
        ? Math.round(result.totalCoverageRatio * 100)
        : 0;
      const minCoveragePct = Number.isFinite(result.achievedMinCoverage)
        ? Math.round(result.achievedMinCoverage * 100)
        : 0;
      const targetPct = algoMode === "best-safe-100" ? 100 : 90;
      const floorPct = algoMode === "best-safe-100" ? 75 : 80;

      return `Coverage check: total ${totalCoveragePct}% (target ${targetPct}%), weakest stat ${minCoveragePct}% (floor ${floorPct}). `;
    }

    function buildBestHigherTierTip(input, currentTierTotalItems) {
      const {
        activeTier,
        highestLimit,
        materialTiers,
        limitValues,
        maxValues,
        algoMode
      } = input;

      const maxTier = Math.max(...Object.keys(materialTiers).map((key) => Number(key)));
      const reachableTierResults = [];

      for (let tier = activeTier + 1; tier <= maxTier; tier += 1) {
        const threshold = tierMinLevel(tier);
        if (highestLimit < threshold) continue;

        const candidateMaterials = materialTiers[tier];
        if (!candidateMaterials) continue;

        const tierResult = calculateFeedForTier(limitValues, maxValues, candidateMaterials, algoMode, tier);
        const tierTotalItems = getResultTotalItems(tierResult);
        if (!Number.isFinite(tierTotalItems)) continue;

        reachableTierResults.push({ tier, threshold, totalItems: tierTotalItems });
      }

      if (reachableTierResults.length === 0) {
        return null;
      }

      const bestHigherTotal = Math.min(...reachableTierResults.map((entry) => entry.totalItems));
      if (bestHigherTotal >= currentTierTotalItems) {
        return null;
      }

      const best = reachableTierResults
        .filter((entry) => entry.totalItems === bestHigherTotal)
        .sort((a, b) => b.tier - a.tier)[0];

      return {
        threshold: best.threshold,
        tier: best.tier,
        totalItems: best.totalItems,
        currentTierTotalItems
      };
    }

    function plan(input) {
      const {
        limitValues,
        maxValues,
        activeTier,
        activeMaterials,
        algoMode,
        materialTiers
      } = input;

      const result = calculateFeedForTier(limitValues, maxValues, activeMaterials, algoMode, activeTier);
      if (!(result && result.feasible)) {
        return {
          feasible: false,
          reason: result && result.reason ? result.reason : "",
          mode: "off-training"
        };
      }

      const itemCounts = extractItemCounts(result, activeMaterials);
      const currentTierTotalItems = Number.isFinite(result.totalItems)
        ? result.totalItems
        : Object.values(itemCounts).reduce((sum, qty) => sum + qty, 0);
      const feedingTime = calculateDynamicFeedingTime(limitValues, itemCounts, activeMaterials, maxValues);
      const advancedTimeline = createAdvancedTimeline(limitValues, itemCounts, activeMaterials, maxValues);

      return {
        feasible: true,
        mode: "off-training",
        activeTier,
        activeMaterials,
        itemCounts,
        currentTierTotalItems,
        feedingTime,
        coverageSummary: buildCoverageSummary(result, algoMode),
        advancedTimeline,
        feedingTimeline: buildFeedingTimelineFromAdvancedTimeline(advancedTimeline),
        tip: buildBestHigherTierTip(
          {
            ...input,
            materialTiers
          },
          currentTierTotalItems
        )
      };
    }

    return {
      plan
    };
  }

  window.createOffTrainingPlanner = createOffTrainingPlanner;
})();
