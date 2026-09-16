import { join } from "node:path";
import { DesktopScene, desktopAtlas, PIXEL, type Screen } from "./desktop-scene.ts";
import { MusicTracker } from "./music.ts";
import { SessionTracker } from "./sessions.ts";
import { MUSIC_COLORS } from "./singer.ts";
import { QuotaTracker, QuotaAlerts, quotaAtlas, type QuotaChange } from "./quota.ts";
import { combatAtlas, TypingCombat } from "./combat.ts";
import { TypingStats, type TypingPulse } from "./typing-stats.ts";

/** Private local pipe; only anonymous typing history is persisted, never agent session data. */
export async function startDesktop(): Promise<void> {
  if (process.platform !== "darwin") throw new Error("Desktop mode requires macOS.");
  const nativePath = join(import.meta.dir, "../dist/pets-desktop-overlay");
  if (!await Bun.file(nativePath).exists()) throw new Error("Build the desktop overlay first: bun run build:desktop");
  const scene = new DesktopScene();
  const sessions = new SessionTracker();
  const music = new MusicTracker();
  const combat = new TypingCombat();
  const quotas = new QuotaTracker();
  const quotaAlerts = new QuotaAlerts();
  let stats: TypingStats | undefined;
  let statsError: string | undefined;
  let statsVisible = false, lastStatsSent = -Infinity;
  let utcOffsetMinutes: number | undefined;
  let achievementNotice: { id: string; title: string; count: number; expires: number } | undefined;
  const statsFailed = (error: unknown): void => {
    statsError = `Typing history is not recording: ${String(error)}. Open Stats & Achievements and Refresh to retry.`;
    console.error(statsError);
    try { stats?.close(); } catch { /* Preserve the original storage error. */ }
    stats = undefined;
  };
  const openStats = (): void => {
    try { stats = new TypingStats(); statsError = undefined; }
    catch (error) { statsFailed(error); }
  };
  let pendingQuotas: QuotaChange[] = [];
  let quotaRequest = 0;
  const native = Bun.spawn([nativePath], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  let closed = false, paused = false, reducedMotion = false, hidden = false, writing = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let failure: unknown;
  let previous = performance.now();
  let lastSent = -Infinity;
  const finish = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    music.stop();
    try { stats?.close(); } catch (error) { console.error("Closing typing history:", error); }
    native.stdin.end();
    native.kill();
  };
  const stop = (): void => { finish(); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("SIGHUP", stop);
  process.on("exit", finish);

  const send = async (message: unknown): Promise<void> => {
    if (closed) return;
    native.stdin.write(JSON.stringify(message) + "\n");
    await native.stdin.flush();
  };
  const sendStats = async (message?: string): Promise<void> => {
    let snapshot;
    try { snapshot = stats?.snapshot(Date.now(), utcOffsetMinutes); } catch (error) { statsFailed(error); }
    await send({ type: "stats", stats: { snapshot, error: statsError, message } });
    lastStatsSent = performance.now();
  };
  const resetCombat = (): void => { combat.reset(); stats?.resetCombo(); };
  const readEvents = async (): Promise<void> => {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of native.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      if (buffer.length > 1_048_576) throw new Error("Invalid desktop overlay response");
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        if (!line) continue;
        const event = JSON.parse(line) as {
          type: string; screens?: Screen[]; paused?: boolean; reducedMotion?: boolean; hidden?: boolean;
          ages?: number[]; x?: number; y?: number; request?: number; screen?: string; visible?: boolean;
          utcOffsetMinutes?: number;
          timestamps?: number[]; offsets?: number[];
        };
        if (Number.isInteger(event.utcOffsetMinutes) && Math.abs(event.utcOffsetMinutes!) <= 14 * 60) utcOffsetMinutes = event.utcOffsetMinutes;
        if (event.type === "screens" && Array.isArray(event.screens)) scene.setScreens(event.screens);
        if (event.type === "quotaScreen" && event.request === quotaRequest && pendingQuotas.length) {
          if (!paused && !hidden && typeof event.screen === "string") quotaAlerts.show(pendingQuotas, event.screen, performance.now());
          pendingQuotas = [];
        }
        if (event.type === "statsVisibility") statsVisible = event.visible === true;
        if (event.type === "statsRequest") {
          if (!stats) { resetCombat(); openStats(); }
          await sendStats();
        }
        if (event.type === "statsReset") {
          try { stats?.clear(); resetCombat(); achievementNotice = undefined; }
          catch (error) { statsFailed(error); }
          await sendStats(statsError ? undefined : "History reset. Your next keystroke starts a fresh history.");
        }
        if (event.type === "combatReset") resetCombat();
        if (event.type === "typing" && !paused && !hidden && Array.isArray(event.ages) &&
            typeof event.x === "number" && typeof event.y === "number") {
          const received = performance.now();
          const pulses: TypingPulse[] = [];
          for (const [index, age] of event.ages.slice(0, 32).entries()) {
            if (Number.isFinite(age) && age >= 0 && age < 500 && Number.isFinite(event.x) && Number.isFinite(event.y)) {
              const monotonic = received - age;
              const comboHit = combat.hit(monotonic, { x: event.x, y: event.y });
              const at = event.timestamps?.[index], offset = event.offsets?.[index];
              if (typeof at === "number" && Number.isFinite(at) && at >= 0 &&
                  typeof offset === "number" && Number.isInteger(offset) && Math.abs(offset) <= 14 * 60) {
                pulses.push({ at, monotonic, comboHit, utcOffsetMinutes: offset });
              }
            }
          }
          try {
            const unlocked = stats?.record(pulses) ?? [];
            if (unlocked.length) {
              achievementNotice = { id: crypto.randomUUID(), title: unlocked[0]!.title, count: unlocked.length, expires: received + 5_000 };
            }
          } catch (error) { statsFailed(error); }
        }
        if (event.type === "options") {
          paused = event.paused === true;
          reducedMotion = event.reducedMotion === true;
          hidden = event.hidden === true;
          if (paused || hidden) { resetCombat(); quotaAlerts.clear(); pendingQuotas = []; achievementNotice = undefined; }
        }
      }
    }
  };
  try {
    openStats();
    await send({ type: "setup", atlas: { ...desktopAtlas(), ...combatAtlas(), ...quotaAtlas() }, pixel: PIXEL, colors: MUSIC_COLORS });
    const events = readEvents();
    // Attach the rejection handler immediately, including during the initial process scan.
    const eventResult = events.catch(error => { failure = error; finish(); });
    const tick = async (): Promise<void> => {
      if (closed || writing) return;
      writing = true;
      try {
        const now = performance.now(), dt = (now - previous) / 1000;
        // Keep state fresh while avoiding full-display redraws for an empty/frozen scene.
        const still = paused || reducedMotion || hidden || (!scene.pets.size && !scene.hasEffects && !music.view() && !combat.state(now) && !quotaAlerts.active(now));
        if (still && now - lastSent < 250) return;
        lastSent = now;
        previous = now;
        if (statsVisible && now - lastStatsSent >= 1_000) await sendStats();
        void sessions.poll(Date.now()).catch(error => { console.error("Session scan:", error); });
        void music.poll();
        void quotas.poll().then(changes => {
          if (closed || paused || hidden || !changes.length) return;
          pendingQuotas = changes;
          quotaRequest++;
        });
        const frame = scene.update(sessions.list(), music.view(), dt, paused || reducedMotion || hidden);
        frame.status = `${sessions.lastError ?? music.lastError ?? frame.status} · ${quotas.status}`;
        await send({ ...frame,
          typingStatsStatus: statsError ?? "Typing history ready · Stats & Achievements…",
          achievementNotice: achievementNotice && now < achievementNotice.expires ? achievementNotice : undefined,
          quotaRequest: pendingQuotas.length ? quotaRequest : undefined,
          combat: paused || hidden ? [] : [...combat.render(now, scene.screens, reducedMotion), ...quotaAlerts.render(now, scene.screens, reducedMotion)],
        });
      } catch (error) {
        if (!closed) { failure = error; finish(); }
      } finally { writing = false; }
    };
    timer = setInterval(() => { void tick(); }, 1000 / 30);
    console.log("pets desktop mode · use the menu-bar football to pause, hide, or quit. Ctrl+C also quits.");
    const code = await native.exited;
    finish();
    await eventResult;
    if (failure) throw failure;
    if (code && code !== 143 && code !== 130) throw new Error(`Desktop overlay exited (${code})`);
  } finally {
    finish();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    process.off("SIGHUP", stop);
    process.off("exit", finish);
  }
}

if (import.meta.main) {
  try { await startDesktop(); }
  catch (error) { console.error(String(error)); process.exitCode = 1; }
}
