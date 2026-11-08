const EFFECTS = ["lensFlares", "localReflections", "contactShadows"];
const empty = () => Object.fromEntries(EFFECTS.map((key) => [key, false]));
const p80 = (samples) => {
  if (!samples.length) return null;
  const ordered = [...samples].sort((a, b) => a - b);
  return ordered[Math.ceil(ordered.length * 0.8) - 1];
};
const validFrame = (n) => Number.isFinite(n) && n >= 1 && n <= 2000;

/** A capped24FPS display on60Hz legitimately has a50ms P80 cadence. */
export function autoEffectFrameBudget(targetFps = 60, refreshRate = 60) {
  const fps = [24, 30, 60].includes(targetFps) ? targetFps : 60;
  const hz =
    Number.isFinite(refreshRate) && refreshRate >= 24 ? refreshRate : 60;
  return (Math.ceil(hz / fps) * 1000) / hz;
}

export function autoEffectEligibility({
  capabilities = {},
  supported = {},
} = {}) {
  const memory = capabilities.deviceMemory;
  const knownMemory = Number.isFinite(memory) && memory > 0;
  const heavyMemory = !knownMemory || memory > 4;
  const hardware = capabilities.software !== true;
  const supports = (key) =>
    supported[key] !== false && capabilities[`${key}Supported`] !== false;
  return {
    lensFlares: hardware && supports("lensFlares"),
    localReflections:
      hardware &&
      heavyMemory &&
      supports("localReflections") &&
      (capabilities.maxCubemapSize ?? capabilities.maxTextureSize ?? 0) >= 128,
    contactShadows:
      hardware &&
      knownMemory &&
      memory > 4 &&
      supports("contactShadows") &&
      (capabilities.maxTextureSize ?? 0) >= 4096,
  };
}

/**
 * Device-local qualification, driven ONLY by actual presented-world intervals.
 * Configure is idempotent. Automatic transitions wait for safe visible idle;
 * explicit On/Off choices are always merged unchanged. No base quality or room
 * data is written. Renderer readiness/warming must describe actual resources.
 */
export function createAutoEffects(initial = {}) {
  let config = {},
    configKey = null,
    choices = {},
    eligibility = empty(),
    budget = 1000 / 60;
  let automatic = empty(),
    accepted = empty(),
    stage = null;
  let heavyAttempted = false,
    lensAttempted = false,
    shutdownLocked = false;
  let pendingReset = true,
    pendingOff = false,
    needsFresh = true,
    idleFresh = true;
  let phase = "waiting",
    reason = "Waiting for base calibration and safe idle";
  let monitor = [],
    badWindows = 0,
    baselineP80 = null,
    generation = 0,
    reports = [];

  function merged() {
    return Object.fromEntries(
      EFFECTS.map((key) => [
        key,
        choices[key] === "on" || (choices[key] === "auto" && automatic[key]),
      ]),
    );
  }
  function describe() {
    return {
      flags: merged(),
      autoFlags: { ...automatic },
      phase,
      baselineSamples: stage?.baseline.length ?? 0,
      trialSamples: stage?.samples.length ?? 0,
      monitorSamples: monitor.length,
      badWindows,
      baselineP80,
      budgetMs: budget,
      eligibility: { ...eligibility },
      pendingFallback: pendingOff,
      pendingReset,
      reason,
      generation,
      reports: reports.map((report) => ({ ...report })),
      deferredLens:
        choices.lensFlares === "auto" &&
        eligibility.lensFlares &&
        !lensAttempted,
    };
  }
  function reset() {
    automatic = empty();
    accepted = empty();
    stage = null;
    heavyAttempted = lensAttempted = shutdownLocked = pendingOff = false;
    pendingReset = false;
    idleFresh = true;
    monitor = [];
    badWindows = 0;
    baselineP80 = null;
    reports = [];
    generation++;
    phase = "waiting";
    reason = "Collecting a fresh device-local qualification";
  }
  function configure(next = {}) {
    const combined = { ...config, ...next };
    const nextChoices = Object.fromEntries(
      EFFECTS.map((key) => [key, combined.choices?.[key] ?? "auto"]),
    );
    for (const key of EFFECTS)
      if (!["auto", "on", "off"].includes(nextChoices[key]))
        throw Error(`Invalid ${key} preference`);
    const caps = combined.capabilities ?? {},
      support = combined.supported ?? {};
    const key = JSON.stringify([
      nextChoices,
      caps.software,
      caps.deviceMemory,
      caps.maxCubemapSize,
      caps.maxTextureSize,
      caps.refreshRate,
      EFFECTS.map((k) => [support[k], caps[`${k}Supported`]]),
      combined.targetFps,
      combined.qualificationKey,
    ]);
    config = combined;
    choices = nextChoices;
    eligibility = autoEffectEligibility({
      capabilities: caps,
      supported: support,
    });
    budget = autoEffectFrameBudget(combined.targetFps, caps.refreshRate);
    if (key !== configKey) {
      configKey = key;
      pendingReset = true;
      needsFresh = true;
    }
    return describe();
  }
  function candidates(kind) {
    if (kind === "lens") return [{ ...accepted, lensFlares: true }];
    const full = { ...accepted };
    for (const key of ["localReflections", "contactShadows"])
      full[key] = choices[key] === "auto" && eligibility[key];
    const list = [full, { ...full, contactShadows: false }];
    const seen = new Set();
    return list.filter((flags) => {
      const key = JSON.stringify(flags);
      if (seen.has(key) || (!flags.localReflections && !flags.contactShadows))
        return false;
      seen.add(key);
      return true;
    });
  }
  function begin(kind) {
    if (kind === "heavy") heavyAttempted = true;
    else lensAttempted = true;
    const queue = candidates(kind);
    if (!queue.length) return false;
    stage = {
      kind,
      baseline: [],
      samples: [],
      queue,
      index: 0,
      warmAt: null,
      lampMissingMs: 0,
    };
    phase = kind === "lens" ? "lens-baseline" : "baseline";
    reason =
      kind === "lens"
        ? "Measuring actual visible-lamp cost"
        : "Measuring base scene before optional effects";
    idleFresh = true;
    return true;
  }
  function trial() {
    automatic = { ...stage.queue[stage.index] };
    stage.samples = [];
    stage.warmAt = null;
    phase = stage.kind === "lens" ? "lens-warming" : "warming";
    reason = "Waiting for completed resources and750ms warm recovery";
    idleFresh = true;
  }
  function settle(success, measured) {
    const kind = stage.kind;
    reports.push({
      kind,
      candidate: stage.index,
      baselineP80: stage.baseP80,
      p80: measured,
      accepted: success,
      baselineSamples: stage.baseline.length,
      trialSamples: stage.samples.length,
    });
    reports = reports.slice(-6);
    if (success) {
      accepted = { ...automatic };
      baselineP80 = stage.baseP80;
      stage = null;
      monitor = [];
      badWindows = 0;
      phase = "accepted";
      reason = "Measured optional effects fit the frame budget";
    } else if (++stage.index < stage.queue.length) {
      trial();
      reason = "Trying lighter optional effects without lowering base quality";
    } else {
      automatic = { ...accepted };
      stage = null;
      monitor = [];
      badWindows = 0;
      phase = Object.values(accepted).some(Boolean) ? "accepted" : "limited";
      reason =
        kind === "lens"
          ? "Visible flares exceeded the measured budget"
          : "Heavy effects exceeded the measured budget";
    }
  }
  configure(initial);
  return {
    configure,
    describe,
    get flags() {
      return merged();
    },
    get phase() {
      return phase;
    },
    retest() {
      pendingReset = true;
      needsFresh = true;
      reason = "Retest requested; waiting for safe idle";
      return describe();
    },
    update({
      time,
      frameMs,
      safe = false,
      visible = true,
      ready = true,
      testing = false,
      resourcesReady = true,
      warming = false,
      lampVisible = false,
    } = {}) {
      const available = visible && ready && !testing;
      if (!available) {
        needsFresh = true;
        idleFresh = true;
        monitor = [];
        badWindows = 0;
        if (stage) stage.warmAt = null;
        return describe();
      }
      if (pendingReset && safe) reset();
      if (pendingReset) return describe();
      if (pendingOff) {
        if (safe) {
          automatic = empty();
          accepted = empty();
          stage = null;
          pendingOff = false;
          shutdownLocked = true;
          phase = "limited";
          reason =
            "Sustained frame loss: automatic effects disabled at safe idle; Retest to retry";
        }
        return describe();
      }
      if (needsFresh) {
        needsFresh = false;
        return describe();
      }
      if (warming) {
        if (stage) stage.warmAt = null;
        idleFresh = true;
        return describe();
      }
      if (!validFrame(frameMs) || !Number.isFinite(time)) return describe();

      // The watch includes actual rolling/payout frames. A poor trial or watch
      // never changes settings during them; transitions use the safe gate above.
      if (!stage && Object.values(accepted).some(Boolean) && !shutdownLocked) {
        monitor.push(frameMs);
        if (monitor.length >= 60) {
          const measured = p80(monitor);
          monitor = [];
          const bad =
            measured > budget * 1.35 ||
            (baselineP80 !== null && measured > baselineP80 * 1.3 + 1.5);
          badWindows = bad ? badWindows + 1 : 0;
          if (badWindows >= 2) {
            pendingOff = true;
            phase = "pending-off";
            reason = "Sustained frame loss; waiting for safe idle";
            return describe();
          }
        }
      }
      if (shutdownLocked) return describe();
      if (!safe) {
        idleFresh = true;
        return describe();
      }
      if (!resourcesReady) {
        if (stage) stage.warmAt = null;
        idleFresh = true;
        return describe();
      }
      if (!stage) {
        if (!heavyAttempted) begin("heavy");
        if (
          !stage &&
          choices.lensFlares === "auto" &&
          eligibility.lensFlares &&
          !lensAttempted &&
          lampVisible
        )
          begin("lens");
        if (!stage) {
          if (EFFECTS.every((key) => choices[key] !== "auto")) {
            phase = "manual";
            reason =
              "Explicit effect preferences bypass automatic qualification";
          } else if (!Object.values(accepted).some(Boolean)) {
            phase = "limited";
            reason =
              "No eligible untested effects; visible-lamp trial can wait";
          }
          return describe();
        }
      }
      if (idleFresh) {
        idleFresh = false;
        return describe();
      }
      // Lens qualification is separate: hidden lamps cannot prove flare cost.
      // Pause while out of view; after3s cancel this uncompleted trial and leave
      // it deferred, rather than holding unmeasured heavy effects on indefinitely.
      if (stage.kind === "lens" && !lampVisible) {
        stage.lampMissingMs += frameMs;
        if (stage.lampMissingMs >= 3000) {
          automatic = { ...accepted };
          stage = null;
          lensAttempted = false;
          phase = "accepted";
          reason = "Visible lamp left view; flare trial deferred";
        }
        return describe();
      }
      if (stage.kind === "lens") stage.lampMissingMs = 0;
      if (phase.endsWith("baseline")) {
        stage.baseline.push(frameMs);
        if (stage.baseline.length >= 45) {
          stage.baseP80 = p80(stage.baseline);
          baselineP80 = stage.baseP80;
          trial();
        }
      } else if (phase.endsWith("warming")) {
        stage.warmAt ??= time;
        if (time - stage.warmAt >= 750) {
          phase = stage.kind === "lens" ? "lens-trial" : "trial";
          stage.samples = [];
          idleFresh = true;
        }
      } else if (phase.endsWith("trial")) {
        stage.samples.push(frameMs);
        if (stage.samples.length >= 60) {
          const measured = p80(stage.samples);
          settle(
            measured <= budget * 1.15 && measured <= stage.baseP80 * 1.15 + 0.5,
            measured,
          );
        }
      }
      return describe();
    },
  };
}
