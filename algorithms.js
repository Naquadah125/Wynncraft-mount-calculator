(function () {
  function createMountAlgorithms(stats) {
    function buildContext(currentLimit, maxLimit, itemDatabase) {
      const itemNames = Object.keys(itemDatabase);
      const deficits = stats.map((stat) => Math.max(0, Number(maxLimit[stat] || 0) - Number(currentLimit[stat] || 0)));
      const itemVectors = itemNames.map((name) => stats.map((stat) => Number(itemDatabase[name][stat] || 0)));
      return { itemNames, deficits, itemVectors };
    }

    function evaluateCounts(counts, deficits, itemVectors) {
      const gains = Array(stats.length).fill(0);
      let totalItems = 0;

      for (let i = 0; i < counts.length; i += 1) {
        const qty = counts[i] || 0;
        if (qty <= 0) continue;
        totalItems += qty;
        for (let j = 0; j < stats.length; j += 1) {
          gains[j] += itemVectors[i][j] * qty;
        }
      }

      const overshoots = deficits.map((need, idx) => Math.max(0, gains[idx] - need));
      const remaining = deficits.map((need, idx) => Math.max(0, need - gains[idx]));

      return {
        gains,
        overshoots,
        remaining,
        totalItems,
        totalOvershoot: overshoots.reduce((sum, value) => sum + value, 0),
        maxOvershootValue: overshoots.reduce((max, value) => Math.max(max, value), 0),
        isValid: remaining.every((value) => value === 0)
      };
    }

    function countsToUsedItems(counts, itemNames) {
      const usedItems = {};
      for (let i = 0; i < counts.length; i += 1) {
        const qty = counts[i] || 0;
        if (qty > 0) usedItems[itemNames[i]] = qty;
      }
      return usedItems;
    }

    function overshootsToDetails(overshoots) {
      const details = {};
      for (let i = 0; i < stats.length; i += 1) {
        details[stats[i]] = overshoots[i] || 0;
      }
      return details;
    }

    function calculateOptimalFeed(currentLimit, maxLimit, itemDatabase) {
      const { itemNames, deficits, itemVectors } = buildContext(currentLimit, maxLimit, itemDatabase);

      if (deficits.every((value) => value <= 0)) {
        return {
          feasible: true,
          usedItems: {},
          totalItems: 0,
          overshootDetails: overshootsToDetails(Array(stats.length).fill(0)),
          maxOvershootValue: 0,
          totalOvershoot: 0
        };
      }

      for (let statIndex = 0; statIndex < stats.length; statIndex += 1) {
        if (deficits[statIndex] <= 0) continue;
        let reachable = false;
        for (let itemIndex = 0; itemIndex < itemVectors.length; itemIndex += 1) {
          if (itemVectors[itemIndex][statIndex] > 0) {
            reachable = true;
            break;
          }
        }
        if (!reachable) {
          return {
            feasible: false,
            reason: "No item can increase " + stats[statIndex] + " toward target."
          };
        }
      }

      const sortedItems = itemNames.map((name, index) => ({
        name,
        index,
        vector: itemVectors[index],
        totalGain: itemVectors[index].reduce((sum, value) => sum + value, 0)
      })).sort((a, b) => b.totalGain - a.totalGain);

      const sortedNames = sortedItems.map((entry) => entry.name);
      const sortedVectors = sortedItems.map((entry) => entry.vector);

      const suffixMax = Array.from({ length: sortedVectors.length + 1 }, () => Array(stats.length).fill(0));
      for (let i = sortedVectors.length - 1; i >= 0; i -= 1) {
        for (let j = 0; j < stats.length; j += 1) {
          suffixMax[i][j] = Math.max(suffixMax[i + 1][j], sortedVectors[i][j]);
        }
      }

      function canStillReach(gains, remainingSlots, startIndex) {
        for (let j = 0; j < stats.length; j += 1) {
          const remainingNeed = Math.max(0, deficits[j] - gains[j]);
          if (remainingNeed <= 0) continue;
          const bestPerItem = suffixMax[startIndex][j];
          if (bestPerItem <= 0) return false;
          if (bestPerItem * remainingSlots < remainingNeed) return false;
        }
        return true;
      }

      const maxDepth = 15;

      for (let depth = 1; depth <= maxDepth; depth += 1) {
        let bestCounts = null;
        let bestMaxOvershoot = Number.POSITIVE_INFINITY;
        let bestTotalOvershoot = Number.POSITIVE_INFINITY;
        const counts = Array(sortedVectors.length).fill(0);
        const gains = Array(stats.length).fill(0);

        function dfs(startIndex, picked) {
          const remainingSlots = depth - picked;
          if (remainingSlots < 0) return;
          if (!canStillReach(gains, remainingSlots, startIndex)) return;

          if (picked === depth) {
            const evaluation = evaluateCounts(counts, deficits, sortedVectors);
            if (!evaluation.isValid) return;

            if (
              evaluation.maxOvershootValue < bestMaxOvershoot
              || (
                evaluation.maxOvershootValue === bestMaxOvershoot
                && evaluation.totalOvershoot < bestTotalOvershoot
              )
            ) {
              bestCounts = counts.slice();
              bestMaxOvershoot = evaluation.maxOvershootValue;
              bestTotalOvershoot = evaluation.totalOvershoot;
            }
            return;
          }

          for (let i = startIndex; i < sortedVectors.length; i += 1) {
            counts[i] += 1;
            for (let j = 0; j < stats.length; j += 1) {
              gains[j] += sortedVectors[i][j];
            }

            dfs(i, picked + 1);

            for (let j = 0; j < stats.length; j += 1) {
              gains[j] -= sortedVectors[i][j];
            }
            counts[i] -= 1;
          }
        }

        dfs(0, 0);

        if (bestCounts) {
          const finalEval = evaluateCounts(bestCounts, deficits, sortedVectors);
          return {
            feasible: true,
            usedItems: countsToUsedItems(bestCounts, sortedNames),
            totalItems: depth,
            overshootDetails: overshootsToDetails(finalEval.overshoots),
            maxOvershootValue: finalEval.maxOvershootValue,
            totalOvershoot: finalEval.totalOvershoot
          };
        }
      }

      return {
        feasible: false,
        reason: "No valid combination found within depth limit 15."
      };
    }

    function calculateBestSafeFeed(currentLimit, maxLimit, itemDatabase, options = {}) {
      const { itemNames, deficits, itemVectors } = buildContext(currentLimit, maxLimit, itemDatabase);
      const softOvershoot = Number.isFinite(options.softOvershoot)
        ? Math.max(0, Number(options.softOvershoot))
        : 3;
      const maxDepth = Number.isFinite(options.maxDepth)
        ? Math.max(0, Math.floor(Number(options.maxDepth)))
        : 15;

      if (deficits.every((value) => value <= 0)) {
        return {
          feasible: true,
          usedItems: {},
          totalItems: 0,
          overshootDetails: overshootsToDetails(Array(stats.length).fill(0)),
          maxOvershootValue: 0,
          totalOvershoot: 0,
          coveredTotal: 0,
          totalRemaining: 0,
          maxRemaining: 0,
          softOvershoot
        };
      }

      const sortedItems = itemNames.map((name, index) => ({
        name,
        index,
        vector: itemVectors[index],
        totalGain: itemVectors[index].reduce((sum, value) => sum + value, 0)
      })).sort((a, b) => b.totalGain - a.totalGain);

      const sortedNames = sortedItems.map((entry) => entry.name);
      const sortedVectors = sortedItems.map((entry) => entry.vector);

      let bestCounts = Array(sortedVectors.length).fill(0);
      let bestEval = evaluateCounts(bestCounts, deficits, sortedVectors);

      function isWithinSoftCap(evaluation) {
        return evaluation.overshoots.every((value) => value <= softOvershoot);
      }

      function compareCandidates(nextEval, nextItems, prevEval, prevItems) {
        const nextCovered = deficits.reduce((sum, need, idx) => sum + Math.min(need, nextEval.gains[idx]), 0);
        const prevCovered = deficits.reduce((sum, need, idx) => sum + Math.min(need, prevEval.gains[idx]), 0);

        if (nextCovered !== prevCovered) return nextCovered > prevCovered;
        if (nextEval.maxRemaining !== prevEval.maxRemaining) return nextEval.maxRemaining < prevEval.maxRemaining;
        if (nextEval.totalOvershoot !== prevEval.totalOvershoot) return nextEval.totalOvershoot < prevEval.totalOvershoot;
        if (nextEval.maxOvershootValue !== prevEval.maxOvershootValue) return nextEval.maxOvershootValue < prevEval.maxOvershootValue;
        if (nextItems !== prevItems) return nextItems < prevItems;

        return false;
      }

      const counts = Array(sortedVectors.length).fill(0);
      const gains = Array(stats.length).fill(0);

      function dfs(startIndex, picked) {
        const currentEval = evaluateCounts(counts, deficits, sortedVectors);
        if (!isWithinSoftCap(currentEval)) return;

        if (compareCandidates(currentEval, picked, bestEval, bestEval.totalItems)) {
          bestCounts = counts.slice();
          bestEval = currentEval;
          bestEval.totalItems = picked;
        }

        if (picked >= maxDepth) return;

        for (let i = startIndex; i < sortedVectors.length; i += 1) {
          counts[i] += 1;
          for (let j = 0; j < stats.length; j += 1) {
            gains[j] += sortedVectors[i][j];
          }

          dfs(i, picked + 1);

          for (let j = 0; j < stats.length; j += 1) {
            gains[j] -= sortedVectors[i][j];
          }
          counts[i] -= 1;
        }
      }

      dfs(0, 0);

      const finalEval = evaluateCounts(bestCounts, deficits, sortedVectors);
      const coveredTotal = deficits.reduce((sum, need, idx) => sum + Math.min(need, finalEval.gains[idx]), 0);

      return {
        feasible: coveredTotal > 0,
        usedItems: countsToUsedItems(bestCounts, sortedNames),
        totalItems: bestEval.totalItems || 0,
        overshootDetails: overshootsToDetails(finalEval.overshoots),
        maxOvershootValue: finalEval.maxOvershootValue,
        totalOvershoot: finalEval.totalOvershoot,
        coveredTotal,
        totalRemaining: finalEval.remaining.reduce((sum, value) => sum + value, 0),
        maxRemaining: finalEval.remaining.reduce((max, value) => Math.max(max, value), 0),
        softOvershoot
      };
    }

    function calculateBestSafeFeedWithMinimum(currentLimit, maxLimit, itemDatabase, options = {}) {
      const { itemNames, deficits, itemVectors } = buildContext(currentLimit, maxLimit, itemDatabase);
      const softOvershoot = Number.isFinite(options.softOvershoot)
        ? Math.max(0, Number(options.softOvershoot))
        : 3;
      const maxDepth = Number.isFinite(options.maxDepth)
        ? Math.max(0, Math.floor(Number(options.maxDepth)))
        : 15;
      const minCoverageRatio = Number.isFinite(options.minCoverageRatio)
        ? Math.min(1, Math.max(0, Number(options.minCoverageRatio)))
        : 0.8;
      const perStatFloorRatio = Number.isFinite(options.perStatFloorRatio)
        ? Math.min(1, Math.max(0, Number(options.perStatFloorRatio)))
        : 0.7;
      const targetCoverageRatio = Number.isFinite(options.targetCoverageRatio)
        ? Math.min(1, Math.max(0, Number(options.targetCoverageRatio)))
        : minCoverageRatio;
      const efficiencyFloor = Number.isFinite(options.efficiencyFloor)
        ? Math.max(0, Number(options.efficiencyFloor))
        : 0;

      if (deficits.every((value) => value <= 0)) {
        return {
          feasible: true,
          usedItems: {},
          totalItems: 0,
          overshootDetails: overshootsToDetails(Array(stats.length).fill(0)),
          maxOvershootValue: 0,
          totalOvershoot: 0,
          coveredTotal: 0,
          totalRemaining: 0,
          maxRemaining: 0,
          softOvershoot,
          minCoverageRatio,
          perStatFloorRatio,
          meetsMinimumCoverage: true,
          meetsFloorCoverage: true,
          achievedMinCoverage: 1,
          totalCoverageRatio: 1
        };
      }

      const minTargets = deficits.map((need) => {
        if (need <= 0) return 0;
        return Math.ceil(need * minCoverageRatio);
      });
      const floorTargets = deficits.map((need) => {
        if (need <= 0) return 0;
        return Math.ceil(need * perStatFloorRatio);
      });
      const totalDeficit = deficits.reduce((sum, need) => sum + need, 0);

      const sortedItems = itemNames.map((name, index) => ({
        name,
        index,
        vector: itemVectors[index],
        totalGain: itemVectors[index].reduce((sum, value) => sum + value, 0)
      })).sort((a, b) => b.totalGain - a.totalGain);

      const sortedNames = sortedItems.map((entry) => entry.name);
      const sortedVectors = sortedItems.map((entry) => entry.vector);

      function isWithinSoftCap(evaluation) {
        return evaluation.overshoots.every((value) => value <= softOvershoot);
      }

      function computeCoverageMetrics(evaluation) {
        const coverageByStat = deficits.map((need, idx) => {
          if (need <= 0) return 1;
          return Math.min(1, evaluation.gains[idx] / need);
        });

        const achievedMinCoverage = coverageByStat.reduce((min, value) => Math.min(min, value), 1);
        const meetsMinimumCoverage = deficits.every((need, idx) => need <= 0 || evaluation.gains[idx] >= minTargets[idx]);
        const meetsFloorCoverage = deficits.every((need, idx) => need <= 0 || evaluation.gains[idx] >= floorTargets[idx]);

        const coveredTotal = deficits.reduce((sum, need, idx) => sum + Math.min(need, evaluation.gains[idx]), 0);
        const totalCoverageRatio = totalDeficit > 0 ? (coveredTotal / totalDeficit) : 1;
        const reachesTargetCoverage = totalDeficit <= 0 ? true : totalCoverageRatio >= targetCoverageRatio;
        const totalRemaining = evaluation.remaining.reduce((sum, value) => sum + value, 0);
        const maxRemaining = evaluation.remaining.reduce((max, value) => Math.max(max, value), 0);

        return {
          coverageByStat,
          achievedMinCoverage,
          meetsMinimumCoverage,
          meetsFloorCoverage,
          reachesTargetCoverage,
          coveredTotal,
          totalCoverageRatio,
          totalRemaining,
          maxRemaining
        };
      }

      function getBestMarginalUsefulGain(evaluation, startIndex) {
        const remaining = deficits.map((need, idx) => Math.max(0, need - evaluation.gains[idx]));
        let bestGain = 0;

        for (let i = startIndex; i < sortedVectors.length; i += 1) {
          let usefulGain = 0;
          for (let j = 0; j < stats.length; j += 1) {
            usefulGain += Math.min(remaining[j], sortedVectors[i][j]);
          }
          if (usefulGain > bestGain) {
            bestGain = usefulGain;
          }
        }

        return bestGain;
      }

      function compareCandidates(nextEval, nextItems, prevEval, prevItems) {
        const nextMetrics = computeCoverageMetrics(nextEval);
        const prevMetrics = computeCoverageMetrics(prevEval);

        if (nextMetrics.meetsFloorCoverage !== prevMetrics.meetsFloorCoverage) {
          return nextMetrics.meetsFloorCoverage;
        }
        if (nextMetrics.reachesTargetCoverage !== prevMetrics.reachesTargetCoverage) {
          return nextMetrics.reachesTargetCoverage;
        }
        if (nextMetrics.meetsMinimumCoverage !== prevMetrics.meetsMinimumCoverage) {
          return nextMetrics.meetsMinimumCoverage;
        }
        if (nextMetrics.totalCoverageRatio !== prevMetrics.totalCoverageRatio) {
          return nextMetrics.totalCoverageRatio > prevMetrics.totalCoverageRatio;
        }
        if (nextMetrics.achievedMinCoverage !== prevMetrics.achievedMinCoverage) {
          return nextMetrics.achievedMinCoverage > prevMetrics.achievedMinCoverage;
        }
        if (nextMetrics.coveredTotal !== prevMetrics.coveredTotal) {
          return nextMetrics.coveredTotal > prevMetrics.coveredTotal;
        }
        if (nextMetrics.maxRemaining !== prevMetrics.maxRemaining) {
          return nextMetrics.maxRemaining < prevMetrics.maxRemaining;
        }
        if (nextEval.totalOvershoot !== prevEval.totalOvershoot) {
          return nextEval.totalOvershoot < prevEval.totalOvershoot;
        }
        if (nextEval.maxOvershootValue !== prevEval.maxOvershootValue) {
          return nextEval.maxOvershootValue < prevEval.maxOvershootValue;
        }
        if (nextItems !== prevItems) {
          return nextItems < prevItems;
        }

        return false;
      }

      let bestCounts = Array(sortedVectors.length).fill(0);
      let bestEval = evaluateCounts(bestCounts, deficits, sortedVectors);
      bestEval.totalItems = 0;

      const counts = Array(sortedVectors.length).fill(0);

      function dfs(startIndex, picked) {
        const currentEval = evaluateCounts(counts, deficits, sortedVectors);
        if (!isWithinSoftCap(currentEval)) return;

        const currentMetrics = computeCoverageMetrics(currentEval);
        if (!currentMetrics.reachesTargetCoverage && efficiencyFloor > 0) {
          const bestMarginalUsefulGain = getBestMarginalUsefulGain(currentEval, startIndex);
          if (bestMarginalUsefulGain < efficiencyFloor) return;
        }

        if (compareCandidates(currentEval, picked, bestEval, bestEval.totalItems || 0)) {
          bestCounts = counts.slice();
          bestEval = currentEval;
          bestEval.totalItems = picked;
        }

        if (picked >= maxDepth) return;

        for (let i = startIndex; i < sortedVectors.length; i += 1) {
          counts[i] += 1;
          dfs(i, picked + 1);
          counts[i] -= 1;
        }
      }

      dfs(0, 0);

      const finalEval = evaluateCounts(bestCounts, deficits, sortedVectors);
      const metrics = computeCoverageMetrics(finalEval);

      return {
        feasible: metrics.coveredTotal > 0,
        usedItems: countsToUsedItems(bestCounts, sortedNames),
        totalItems: bestEval.totalItems || 0,
        overshootDetails: overshootsToDetails(finalEval.overshoots),
        maxOvershootValue: finalEval.maxOvershootValue,
        totalOvershoot: finalEval.totalOvershoot,
        coveredTotal: metrics.coveredTotal,
        totalRemaining: metrics.totalRemaining,
        maxRemaining: metrics.maxRemaining,
        softOvershoot,
        minCoverageRatio,
        targetCoverageRatio,
        efficiencyFloor,
        perStatFloorRatio,
        meetsMinimumCoverage: metrics.meetsMinimumCoverage,
        meetsFloorCoverage: metrics.meetsFloorCoverage,
        reachesTargetCoverage: metrics.reachesTargetCoverage,
        achievedMinCoverage: metrics.achievedMinCoverage,
        totalCoverageRatio: metrics.totalCoverageRatio
      };
    }

    return {
      calculateOptimalFeed,
      calculateBestSafeFeed,
      calculateBestSafeFeedWithMinimum
    };
  }

  window.createMountAlgorithms = createMountAlgorithms;
})();
