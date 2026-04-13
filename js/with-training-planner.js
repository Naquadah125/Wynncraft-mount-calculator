(function () {
  function createWithTrainingPlanner(deps) {
    const { STATS, offTrainingPlanner, tierMinLevel } = deps;

    function cloneValues(values) {
      return { ...(values || {}) };
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

    function getAverageLimit(values) {
      return Math.ceil(
        STATS.reduce((sum, stat) => sum + Number(values[stat] || 0), 0) / STATS.length
      );
    }

    function getFeedingTimeForCounts(startValues, itemCounts, activeMaterials) {
      const simulated = cloneValues(startValues);
      let totalMinutes = 0;

      Object.keys(itemCounts).forEach((material) => {
        const qty = Number(itemCounts[material] || 0);
        const stats = activeMaterials[material] || {};

        for (let i = 0; i < qty; i += 1) {
          totalMinutes += getFeedingMinutesPerMaterial(getAverageLimit(simulated));

          STATS.forEach((stat) => {
            simulated[stat] = Number(simulated[stat] || 0) + Number(stats[stat] || 0);
          });
        }
      });

      return totalMinutes;
    }

    function applyMaterialCounts(currentValues, itemCounts, activeMaterials, maxValues) {
      const nextValues = cloneValues(currentValues);

      Object.keys(itemCounts).forEach((material) => {
        const qty = Number(itemCounts[material] || 0);
        const stats = activeMaterials[material] || {};

        for (let i = 0; i < qty; i += 1) {
          STATS.forEach((stat) => {
            nextValues[stat] = Math.min(
              Number(maxValues[stat] || 0),
              Number(nextValues[stat] || 0) + Number(stats[stat] || 0)
            );
          });
        }
      });

      return nextValues;
    }

    function buildCacheKey(input) {
      return [
        "with-training-v13",
        input.algoMode,
        JSON.stringify(input.currentValues || {}),
        JSON.stringify(input.limitValues || {}),
        JSON.stringify(input.maxValues || {}),
        Object.keys(input.materialTiers || {}).join(",")
      ].join("|");
    }

    function getUnlockAlgoMode() {
      // Unlock stage should be strict toward tier thresholds.
      return "optimal-max";
    }

    function readCachedPlan(cacheKey) {
      try {
        const raw = sessionStorage.getItem(cacheKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.steps)) return null;
        return parsed;
      } catch (error) {
        return null;
      }
    }

    function writeCachedPlan(cacheKey, planResult) {
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify(planResult));
      } catch (error) {
        // Ignore cache write failures in restrictive environments.
      }
    }

    function itemCountsToLines(itemCounts, activeMaterials) {
      return Object.keys(itemCounts)
        .filter((material) => Number(itemCounts[material] || 0) > 0)
        .map((material) => ({
          name: material,
          qty: Number(itemCounts[material] || 0),
          stats: activeMaterials[material] || {}
        }));
    }

    function createEatStep(text, itemCounts, activeMaterials) {
      return {
        type: "Eat",
        text,
        items: itemCountsToLines(itemCounts, activeMaterials)
      };
    }

    function buildOvershootSummary(maxValues, advancedTimeline) {
      const summary = {
        total: 0,
        byStat: {}
      };

      if (!Array.isArray(advancedTimeline) || advancedTimeline.length === 0) {
        return summary;
      }

      const finalLimits = advancedTimeline[advancedTimeline.length - 1].limits || {};
      STATS.forEach((stat) => {
        const overshoot = Math.max(0, Number(finalLimits[stat] || 0) - Number(maxValues[stat] || 0));
        summary.byStat[stat] = overshoot;
        summary.total += overshoot;
      });

      return summary;
    }

    function buildAdvancedTimelineFromSteps(startValues, steps, maxValues) {
      const zeroOvershoot = {};
      STATS.forEach((stat) => {
        zeroOvershoot[stat] = 0;
      });

      const timeline = [{ limits: cloneValues(startValues), appliedMaterial: null, overshootTotals: { ...zeroOvershoot } }];
      let running = cloneValues(startValues);
      let runningOvershoot = { ...zeroOvershoot };

      (steps || []).forEach((step) => {
        if (!step || step.type !== "Eat" || !Array.isArray(step.items)) return;

        step.items.forEach((item) => {
          const qty = Number(item && item.qty || 0);
          const itemStats = item && item.stats ? item.stats : {};

          for (let i = 0; i < qty; i += 1) {
            const next = { ...running };
            const nextOvershoot = { ...runningOvershoot };

            STATS.forEach((stat) => {
              const beforeValue = Number(running[stat] || 0);
              const gain = Number(itemStats[stat] || 0);
              const afterValue = beforeValue + gain;
              next[stat] = afterValue;

              const cap = Number(maxValues && maxValues[stat]);
              if (Number.isFinite(cap)) {
                const beforeOver = Math.max(0, beforeValue - cap);
                const afterOver = Math.max(0, afterValue - cap);
                nextOvershoot[stat] = Number(nextOvershoot[stat] || 0) + Math.max(0, afterOver - beforeOver);
              }
            });

            timeline.push({
              limits: next,
              appliedMaterial: item && item.name ? item.name : null,
              overshootTotals: nextOvershoot
            });
            running = next;
            runningOvershoot = nextOvershoot;
          }
        });
      });

      return timeline;
    }

    function runUnlockStageGreedy(startCurrentValues, maxValues, startTier, materialTiers, algoMode) {
      const steps = [];
      const stateCache = [];
      let currentValues = cloneValues(startCurrentValues);
      let currentTier = Number(startTier) || 1;
      let totalMaterialsUsed = 0;
      let totalFeedingMinutes = 0;
      let guard = 0;

      while (guard < 20) {
        guard += 1;

        const nextTier = currentTier + 1;
        const nextMaterials = materialTiers[nextTier];
        if (!nextMaterials) break;

        const threshold = tierMinLevel(nextTier);
        const eligibleStats = STATS.filter((stat) => Number(maxValues[stat] || 0) >= threshold);
        if (eligibleStats.length === 0) break;

        const alreadyUnlockedStat = eligibleStats.find((stat) => Number(currentValues[stat] || 0) >= threshold);
        if (alreadyUnlockedStat) {
          steps.push({
            type: "Unlock",
            text: `Unlock Tier ${nextTier}.`
          });
          stateCache.push({
            step: stateCache.length + 1,
            type: "Unlock",
            tier: nextTier,
            limits: { ...currentValues }
          });
          currentTier = nextTier;
          continue;
        }

        const candidates = eligibleStats.map((stat, idx) => {
          const targetValues = cloneValues(currentValues);
          targetValues[stat] = threshold;

          const result = offTrainingPlanner.plan({
            limitValues: currentValues,
            maxValues: targetValues,
            activeTier: currentTier,
            activeMaterials: materialTiers[currentTier],
            algoMode: getUnlockAlgoMode(),
            materialTiers,
            highestLimit: Math.max(...Object.values(targetValues)),
            highestCurrent: Math.max(...Object.values(currentValues))
          });

          if (!result || !result.feasible) return null;

          return {
            stat,
            idx,
            result
          };
        }).filter(Boolean);

        if (candidates.length === 0) break;

        candidates.sort((a, b) => {
          const aItems = Number(a.result.currentTierTotalItems || 0);
          const bItems = Number(b.result.currentTierTotalItems || 0);
          if (aItems !== bItems) return aItems - bItems;

          const aTime = Number(a.result.feedingTime && a.result.feedingTime.totalMinutes) || 0;
          const bTime = Number(b.result.feedingTime && b.result.feedingTime.totalMinutes) || 0;
          if (aTime !== bTime) return aTime - bTime;

          const aCap = Number(maxValues[a.stat] || 0);
          const bCap = Number(maxValues[b.stat] || 0);
          if (bCap !== aCap) return bCap - aCap;

          const aCurrent = Number(currentValues[a.stat] || 0);
          const bCurrent = Number(currentValues[b.stat] || 0);
          if (bCurrent !== aCurrent) return bCurrent - aCurrent;

          return a.idx - b.idx;
        });

        const best = candidates[0];
        const activeMaterials = materialTiers[currentTier] || {};
        const itemCountTotal = Number(best.result.currentTierTotalItems || 0);

        if (itemCountTotal > 0) {
          steps.push(createEatStep(
            `Use Tier ${currentTier} materials to raise ${best.stat} to ${threshold} for Tier ${nextTier}.`,
            best.result.itemCounts,
            activeMaterials
          ));
        }

        totalMaterialsUsed += itemCountTotal;
        totalFeedingMinutes += Number(best.result.feedingTime && best.result.feedingTime.totalMinutes) || 0;

        currentValues = applyMaterialCounts(currentValues, best.result.itemCounts, activeMaterials, maxValues);
        stateCache.push({
          step: stateCache.length + 1,
          type: "Eat",
          tier: currentTier,
          focusStat: best.stat,
          limits: { ...currentValues },
          usedItems: best.result.itemCounts
        });

        if (Number(currentValues[best.stat] || 0) < threshold) {
          return {
            feasible: false,
            mode: "with-training",
            reason: "No material can raise Stats",
            steps,
            stateCache,
            totalMaterialsUsed,
            totalFeedingMinutes
          };
        }

        steps.push({
          type: "Unlock",
          text: `Unlock Tier ${nextTier}.`
        });
        stateCache.push({
          step: stateCache.length + 1,
          type: "Unlock",
          tier: nextTier,
          limits: { ...currentValues }
        });

        currentTier = nextTier;
      }

      return {
        feasible: true,
        steps,
        stateCache,
        currentValues,
        currentTier,
        totalMaterialsUsed,
        totalFeedingMinutes
      };
    }

    function routeScore(route) {
      return {
        tier: Number(route.currentTier || 1),
        materials: Number(route.totalMaterialsUsed || 0),
        minutes: Number(route.totalFeedingMinutes || 0),
        totalStats: STATS.reduce((sum, stat) => sum + Number(route.currentValues && route.currentValues[stat] || 0), 0)
      };
    }

    function compareRouteForBeam(a, b, algoMode) {
      const sa = routeScore(a);
      const sb = routeScore(b);

      if (algoMode === "best-safe-90") {
        if (sb.tier !== sa.tier) return sb.tier - sa.tier;
      }

      if (sa.materials !== sb.materials) return sa.materials - sb.materials;
      if (sa.minutes !== sb.minutes) return sa.minutes - sb.minutes;
      if (sb.tier !== sa.tier) return sb.tier - sa.tier;
      if (sb.totalStats !== sa.totalStats) return sb.totalStats - sa.totalStats;
      return 0;
    }

    function routeStateKey(route) {
      return `${route.currentTier}|${STATS.map((stat) => Number(route.currentValues && route.currentValues[stat] || 0)).join(",")}`;
    }

    function pruneRoutes(routes, beamWidth, algoMode) {
      const bestByKey = new Map();

      routes.forEach((route) => {
        const key = routeStateKey(route);
        const existing = bestByKey.get(key);
        if (!existing || compareRouteForBeam(route, existing, algoMode) < 0) {
          bestByKey.set(key, route);
        }
      });

      return Array.from(bestByKey.values())
        .sort((a, b) => compareRouteForBeam(a, b, algoMode))
        .slice(0, beamWidth);
    }

    function runUnlockStageBeam(startCurrentValues, maxValues, startTier, materialTiers, algoMode, beamWidth = 10) {
      let frontier = [{
        feasible: true,
        steps: [],
        stateCache: [],
        currentValues: cloneValues(startCurrentValues),
        currentTier: Number(startTier) || 1,
        totalMaterialsUsed: 0,
        totalFeedingMinutes: 0
      }];
      const terminals = [];
      let guard = 0;

      while (guard < 20) {
        guard += 1;
        let progressed = false;
        const nextFrontier = [];

        frontier.forEach((route) => {
          const currentTier = Number(route.currentTier || 1);
          const nextTier = currentTier + 1;
          const nextMaterials = materialTiers[nextTier];

          if (!nextMaterials) {
            terminals.push(route);
            return;
          }

          const threshold = tierMinLevel(nextTier);
          const eligibleStats = STATS.filter((stat) => Number(maxValues[stat] || 0) >= threshold);
          if (eligibleStats.length === 0) {
            terminals.push(route);
            return;
          }

          const alreadyUnlockedStat = eligibleStats.find((stat) => Number(route.currentValues[stat] || 0) >= threshold);
          if (alreadyUnlockedStat) {
            progressed = true;
            nextFrontier.push({
              ...route,
              steps: [...route.steps, { type: "Unlock", text: `Unlock Tier ${nextTier}.` }],
              stateCache: [...route.stateCache, {
                step: route.stateCache.length + 1,
                type: "Unlock",
                tier: nextTier,
                limits: { ...route.currentValues }
              }],
              currentTier: nextTier
            });
            return;
          }

          const unlockCandidates = eligibleStats.map((stat, idx) => {
            const targetValues = cloneValues(route.currentValues);
            targetValues[stat] = threshold;

            const result = offTrainingPlanner.plan({
              limitValues: route.currentValues,
              maxValues: targetValues,
              activeTier: currentTier,
              activeMaterials: materialTiers[currentTier],
              algoMode: getUnlockAlgoMode(),
              materialTiers,
              highestLimit: Math.max(...Object.values(targetValues)),
              highestCurrent: Math.max(...Object.values(route.currentValues))
            });

            if (!result || !result.feasible) return null;

            return {
              stat,
              idx,
              result
            };
          }).filter(Boolean);

          if (unlockCandidates.length === 0) {
            terminals.push(route);
            return;
          }

          unlockCandidates.forEach((candidate) => {
            progressed = true;
            const activeMaterials = materialTiers[currentTier] || {};
            const itemCountTotal = Number(candidate.result.currentTierTotalItems || 0);
            const nextValues = applyMaterialCounts(route.currentValues, candidate.result.itemCounts, activeMaterials, maxValues);
            const nextSteps = [...route.steps];

            if (itemCountTotal > 0) {
              nextSteps.push(createEatStep(
                `Use Tier ${currentTier} materials to raise ${candidate.stat} to ${threshold} for Tier ${nextTier}.`,
                candidate.result.itemCounts,
                activeMaterials
              ));
            }
            nextSteps.push({ type: "Unlock", text: `Unlock Tier ${nextTier}.` });

            const nextStateCache = [...route.stateCache, {
              step: route.stateCache.length + 1,
              type: "Eat",
              tier: currentTier,
              focusStat: candidate.stat,
              limits: { ...nextValues },
              usedItems: candidate.result.itemCounts
            }, {
              step: route.stateCache.length + 2,
              type: "Unlock",
              tier: nextTier,
              limits: { ...nextValues }
            }];

            nextFrontier.push({
              feasible: true,
              steps: nextSteps,
              stateCache: nextStateCache,
              currentValues: nextValues,
              currentTier: nextTier,
              totalMaterialsUsed: Number(route.totalMaterialsUsed || 0) + itemCountTotal,
              totalFeedingMinutes: Number(route.totalFeedingMinutes || 0) + (Number(candidate.result.feedingTime && candidate.result.feedingTime.totalMinutes) || 0)
            });
          });
        });

        if (!progressed) break;
        frontier = pruneRoutes(nextFrontier, beamWidth, algoMode);
        if (frontier.length === 0) break;
      }

      const allRoutes = [...terminals, ...frontier];
      const unique = pruneRoutes(allRoutes, beamWidth, algoMode);

      return unique.length > 0
        ? unique
        : [{
          feasible: true,
          steps: [],
          stateCache: [],
          currentValues: cloneValues(startCurrentValues),
          currentTier: Number(startTier) || 1,
          totalMaterialsUsed: 0,
          totalFeedingMinutes: 0
        }];
    }

    function buildCompletePlanResult(unlockRoute, input, startValues, maxValues, materialTiers, startTier) {
      const finalTier = Number(unlockRoute.currentTier || startTier);
      const finalMaterials = materialTiers[finalTier];

      if (!finalMaterials) {
        return {
          feasible: false,
          mode: "with-training",
          reason: `Material data for Tier ${finalTier} is missing.`,
          steps: unlockRoute.steps,
          stateCache: unlockRoute.stateCache,
          totalMaterialsUsed: unlockRoute.totalMaterialsUsed,
          totalFeedingMinutes: unlockRoute.totalFeedingMinutes
        };
      }

      const stage2 = offTrainingPlanner.plan({
        limitValues: unlockRoute.currentValues,
        maxValues,
        activeTier: finalTier,
        activeMaterials: finalMaterials,
        algoMode: input.algoMode,
        materialTiers,
        highestLimit: Math.max(...Object.values(input.limitValues || unlockRoute.currentValues || {})),
        highestCurrent: Math.max(...Object.values(unlockRoute.currentValues || {}))
      });

      if (!stage2 || !stage2.feasible) {
        return {
          feasible: false,
          mode: "with-training",
          reason: stage2 && stage2.reason ? stage2.reason : "No material can raise Stats",
          steps: unlockRoute.steps,
          stateCache: unlockRoute.stateCache,
          totalMaterialsUsed: unlockRoute.totalMaterialsUsed,
          totalFeedingMinutes: unlockRoute.totalFeedingMinutes
        };
      }

      const stage2ItemCount = Number(stage2.currentTierTotalItems || 0);
      const stage2Step = stage2ItemCount > 0
        ? createEatStep(
          `Use Tier ${finalTier} materials.`,
          stage2.itemCounts,
          finalMaterials
        )
        : null;

      const mergedSteps = stage2Step
        ? [...unlockRoute.steps, stage2Step]
        : unlockRoute.steps;

      const combinedAdvancedTimeline = buildAdvancedTimelineFromSteps(startValues, mergedSteps, maxValues);

      return {
        feasible: true,
        mode: "with-training",
        algoMode: input.algoMode,
        steps: mergedSteps,
        advancedTimeline: combinedAdvancedTimeline,
        stateCache: unlockRoute.stateCache,
        totalMaterialsUsed: Number(unlockRoute.totalMaterialsUsed || 0) + stage2ItemCount,
        totalFeedingMinutes: Number(unlockRoute.totalFeedingMinutes || 0) + (Number(stage2.feedingTime && stage2.feedingTime.totalMinutes) || 0),
        overshootSummary: buildOvershootSummary(maxValues, combinedAdvancedTimeline),
        finalTier,
        stage2StartValues: cloneValues(unlockRoute.currentValues),
        finalCurrentValues: unlockRoute.currentValues,
        stage2
      };
    }

    function comparePlanByCost(a, b) {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;

      const aMaterials = Number(a.totalMaterialsUsed || 0);
      const bMaterials = Number(b.totalMaterialsUsed || 0);
      if (aMaterials !== bMaterials) return aMaterials - bMaterials;

      const aTime = Number(a.totalFeedingMinutes || 0);
      const bTime = Number(b.totalFeedingMinutes || 0);
      if (aTime !== bTime) return aTime - bTime;

      const aSteps = Array.isArray(a.steps) ? a.steps.length : 0;
      const bSteps = Array.isArray(b.steps) ? b.steps.length : 0;
      return aSteps - bSteps;
    }

    function buildBreedingEfficiencyMetrics(plan, maxValues) {
      const metrics = {
        efficiencyRatio: 0,
        totalOvershoot: 0,
        coverageRatio: 0,
        meetsFloor80: false
      };

      if (!plan || !plan.stage2 || !Array.isArray(plan.stage2.advancedTimeline) || plan.stage2.advancedTimeline.length === 0) {
        return metrics;
      }

      const startValues = plan.stage2StartValues || {};
      const finalValues = plan.stage2.advancedTimeline[plan.stage2.advancedTimeline.length - 1].limits || {};
      let totalDeficit = 0;
      let usefulGain = 0;
      let totalGain = 0;
      let totalOvershoot = 0;

      STATS.forEach((stat) => {
        const start = Number(startValues[stat] || 0);
        const max = Number(maxValues[stat] || 0);
        const final = Number(finalValues[stat] || 0);
        const deficit = Math.max(0, max - start);
        const gain = Math.max(0, final - start);
        const useful = Math.min(deficit, gain);
        const overshoot = Math.max(0, gain - deficit);

        totalDeficit += deficit;
        usefulGain += useful;
        totalGain += gain;
        totalOvershoot += overshoot;
      });

      metrics.efficiencyRatio = totalGain > 0 ? usefulGain / totalGain : 0;
      metrics.totalOvershoot = totalOvershoot;
      metrics.coverageRatio = totalDeficit > 0 ? usefulGain / totalDeficit : 1;
      metrics.meetsFloor80 = metrics.efficiencyRatio >= 0.8;

      return metrics;
    }

    function compareBreedingPlan(a, b, maxValues) {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;

      const am = buildBreedingEfficiencyMetrics(a, maxValues);
      const bm = buildBreedingEfficiencyMetrics(b, maxValues);

      if (am.meetsFloor80 !== bm.meetsFloor80) {
        return am.meetsFloor80 ? -1 : 1;
      }
      if (am.efficiencyRatio !== bm.efficiencyRatio) {
        return bm.efficiencyRatio - am.efficiencyRatio;
      }
      if (am.totalOvershoot !== bm.totalOvershoot) {
        return am.totalOvershoot - bm.totalOvershoot;
      }
      if (am.coverageRatio !== bm.coverageRatio) {
        return bm.coverageRatio - am.coverageRatio;
      }

      return comparePlanByCost(a, b);
    }

    function plan(input) {
      const cacheKey = buildCacheKey(input);
      const cached = readCachedPlan(cacheKey);
      if (cached) {
        return cached;
      }

      const materialTiers = input.materialTiers || {};
      const startValues = cloneValues(input.limitValues || input.currentValues || {});
      const startTier = Number(input.activeTier || 1);
      const maxValues = cloneValues(input.maxValues || {});

      const greedyUnlockRoute = runUnlockStageGreedy(startValues, maxValues, startTier, materialTiers, input.algoMode);
      if (!greedyUnlockRoute.feasible) {
        writeCachedPlan(cacheKey, greedyUnlockRoute);
        return greedyUnlockRoute;
      }

      const baselineResult = buildCompletePlanResult(
        greedyUnlockRoute,
        input,
        startValues,
        maxValues,
        materialTiers,
        startTier
      );

      const beamRoutes = runUnlockStageBeam(startValues, maxValues, startTier, materialTiers, input.algoMode, 12);
      const beamResults = beamRoutes
        .map((route) => buildCompletePlanResult(route, input, startValues, maxValues, materialTiers, startTier))
        .filter((result) => result && result.feasible);

      let bestBeamResult = null;
      beamResults.forEach((candidate) => {
        if (!bestBeamResult || comparePlanByCost(candidate, bestBeamResult) < 0) {
          bestBeamResult = candidate;
        }
      });

      let result = baselineResult;

      if (input.algoMode === "best-safe-90") {
        const breedingCandidates = [baselineResult, ...beamResults].filter((entry) => entry && entry.feasible);
        const bestTier = breedingCandidates.length > 0
          ? Math.max(...breedingCandidates.map((entry) => Number(entry.finalTier || 1)))
          : 1;
        const tierFirstCandidates = breedingCandidates.filter((entry) => Number(entry.finalTier || 1) === bestTier);

        tierFirstCandidates.forEach((candidate) => {
          if (!result || compareBreedingPlan(candidate, result, maxValues) < 0) {
            result = candidate;
          }
        });
      } else {
        if (bestBeamResult && baselineResult && baselineResult.feasible) {
          if (comparePlanByCost(bestBeamResult, baselineResult) < 0) {
            result = bestBeamResult;
          }
        } else if (bestBeamResult && bestBeamResult.feasible) {
          result = bestBeamResult;
        }
      }

      if (!result || !result.feasible) {
        result = baselineResult && baselineResult.feasible
          ? baselineResult
          : {
            feasible: false,
            mode: "with-training",
            reason: "No material can raise Stats",
            steps: greedyUnlockRoute.steps,
            stateCache: greedyUnlockRoute.stateCache,
            totalMaterialsUsed: greedyUnlockRoute.totalMaterialsUsed,
            totalFeedingMinutes: greedyUnlockRoute.totalFeedingMinutes
          };
      }

      writeCachedPlan(cacheKey, result);
      return result;
    }

    return {
      plan
    };
  }

  window.createWithTrainingPlanner = createWithTrainingPlanner;
})();
