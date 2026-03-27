import './style.css';
import {
  CreateStartUpPageContainer,
  type EvenAppBridge,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk';

type InputAction = 'CLICK' | 'UP' | 'DOWN' | 'DOUBLE_CLICK';
type CountEventType = 'LOW' | 'NEUTRAL' | 'HIGH';
type HudMode = 'COUNT' | 'MENU' | 'DECKS' | 'CHEAT';

type CountEvent = {
  type: CountEventType;
  delta: number;
};

type AppState = {
  runningCount: number;
  cardsSeen: number;
  decksTotal: number;
  showCheatOnMain: boolean;
  publishStatus: string;
  deployed: boolean;
  lastAction: string;
  history: CountEvent[];
  hudMode: HudMode;
  menuIndex: number;
  disclaimerAccepted: boolean;
};

const MAIN_CONTAINER_ID = 1;
const MAIN_CONTAINER_NAME = 'mainText';
const CONTROL_URL = 'http://127.0.0.1:8787';
const REQUIRED_CONTROL_CAPABILITY = 'publish-app';
const DISPLAY_WIDTH = 576;
const MAIN_PANEL_X = 24;
const MAIN_PANEL_WIDTH = 528;
const HIDE_DEBUG_TOOLS = true;
const DEV_TOOLS_TOGGLE_SHORTCUT = 'Ctrl+Shift+D';
const MAX_APP_NAME_LENGTH = 20;
const DISCLAIMER_SECONDS = 15;

const MENU_ITEMS = ['Undo Last Card', 'New Shoe', 'Adjust Decks', 'Cheat Sheet', 'Close Menu'] as const;

const state: AppState = {
  runningCount: 0,
  cardsSeen: 0,
  decksTotal: 6,
  showCheatOnMain: false,
  publishStatus: 'IDLE',
  deployed: false,
  lastAction: 'Ready',
  history: [],
  hudMode: 'COUNT',
  menuIndex: 0,
  disclaimerAccepted: false,
};

let bridge: EvenAppBridge | null = null;
let startupCreated = false;
let startupMs = Date.now();
let lastResolvedAction: InputAction | null = null;
let lastResolvedActionAt = 0;
let lastEventSignature = '';
let lastEventAt = 0;
let lastEventLabel = '';
let debugToolsVisible = !HIDE_DEBUG_TOOLS;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root element');

app.innerHTML = `
  <main class="hud-shell">
    <fieldset class="group-box">
      <legend>Blackjack Counter Setup</legend>
      <div class="settings-row">
        <div class="mini-field wide-field">
          <label for="decks-total">Shoe Decks</label>
          <input id="decks-total" type="number" min="1" max="8" step="0.5" value="6" />
        </div>
      </div>
      <div class="settings-row">
        <label class="legend-toggle" for="show-cheat-main">
          <span>Show HI-LO CHEAT on main screen</span>
          <input id="show-cheat-main" type="checkbox" />
        </label>
      </div>
      <p class="hint">On glasses: Click=Low, Up=High, Down=Neutral, Double-click=Menu</p>
      <p class="hint">RC = Running Count, TC = True Count</p>
      <p class="hint">Menu actions: undo, new shoe, deck adjust, and card cheat sheet</p>
      <p class="hint">Disclaimer: Training tool only. Casino use may violate house rules or state laws.</p>
    </fieldset>

    <fieldset id="debug-tools" class="group-box" ${HIDE_DEBUG_TOOLS ? 'style="display:none;"' : ''}>
      <legend>Debug Tools</legend>
      <div class="controls">
        <button id="publish-btn" type="button">Publish App</button>
        <button id="ehpk-btn" type="button">Build EHPK</button>
        <span id="publish-status">IDLE</span>
      </div>
      <pre id="event-log" class="event-log"></pre>
      <pre id="publish-log" class="publish-log"></pre>

      <div class="sim-display">
        <pre id="hud-main-preview" class="hud-preview hud-preview-main"></pre>
      </div>
      <p class="hint">Keyboard simulation: Enter=Click, Arrow Up/Down, D=Double-click</p>
    </fieldset>
  </main>
`;

const hudMainPreview = document.querySelector<HTMLPreElement>('#hud-main-preview')!;
const publishBtn = document.querySelector<HTMLButtonElement>('#publish-btn')!;
const ehpkBtn = document.querySelector<HTMLButtonElement>('#ehpk-btn')!;
const debugToolsFieldset = document.querySelector<HTMLElement>('#debug-tools')!;
const decksTotalInput = document.querySelector<HTMLInputElement>('#decks-total')!;
const showCheatMainInput = document.querySelector<HTMLInputElement>('#show-cheat-main')!;
const publishStatus = document.querySelector<HTMLSpanElement>('#publish-status')!;
const eventLog = document.querySelector<HTMLPreElement>('#event-log')!;
const publishLog = document.querySelector<HTMLPreElement>('#publish-log')!;
const eventLines: string[] = [];

const mainPanelLeftPercent = (MAIN_PANEL_X / DISPLAY_WIDTH) * 100;
const mainPanelWidthPercent = (MAIN_PANEL_WIDTH / DISPLAY_WIDTH) * 100;
hudMainPreview.style.left = `${mainPanelLeftPercent}%`;
hudMainPreview.style.width = `${mainPanelWidthPercent}%`;

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clampAppName(value: string): string {
  return String(value || '').trim().slice(0, MAX_APP_NAME_LENGTH);
}

function decksRemaining(): number {
  const cardsLeft = Math.max(0, state.decksTotal * 52 - state.cardsSeen);
  const remaining = cardsLeft / 52;
  return Math.max(0.25, remaining);
}

function trueCount(): number {
  return state.runningCount / decksRemaining();
}

function recommendation(): string {
  const tc = trueCount();
  if (tc >= 4) return 'Bet max spread';
  if (tc >= 3) return 'Bet 3x-4x base';
  if (tc >= 2) return 'Bet 2x base';
  if (tc >= 1) return 'Bet base';
  return 'Bet table min';
}

function advantageEstimate(): number {
  const tc = trueCount();
  return (tc - 1) * 0.5;
}

function signedRounded(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  return `${rounded >= 0 ? '+' : ''}${rounded.toFixed(digits)}`;
}

function disclaimerRemainingSeconds(nowMs = Date.now()): number {
  const elapsed = Math.max(0, nowMs - startupMs);
  const remainingMs = Math.max(0, DISCLAIMER_SECONDS * 1000 - elapsed);
  return Math.ceil(remainingMs / 1000);
}

function buildMenuHudText(): string {
  return [
    'COMMAND MENU',
    `${state.menuIndex === 0 ? '>' : ' '} Undo Last`,
    `${state.menuIndex === 1 ? '>' : ' '} New Shoe`,
    `${state.menuIndex === 2 ? '>' : ' '} Adjust Decks`,
    `${state.menuIndex === 3 ? '>' : ' '} Cheat Sheet`,
    `${state.menuIndex === 4 ? '>' : ' '} Close`,
  ].join('\n');
}

function buildDeckHudText(): string {
  return [
    'DECK ADJUST',
    `Current ${state.decksTotal.toFixed(1)} decks`,
    '\nUP +0.5',
    'DOWN -0.5',
    '\nCLICK save+exit',
    'DBL exit',
  ].join('\n');
}

function buildCheatHudText(): string {
  return [
    'HI-LO CHEAT',
    '(CLICK) +1 : 2 3 4 5 6',
    '(DOWN)   0 : 7 8 9',
    '(UP)    -1 : 10 J Q K A',
    '\n\nCLICK or DBL to return',
  ].join('\n');
}

function buildCountHudText(): string {
  const tc = trueCount();
  const adv = advantageEstimate();
  const cheatLine = 'CLICK(+1):2-6  DOWN(0):7-9  UP(-1):10-A';

  const lines = [
    `DECKS: ${decksRemaining().toFixed(2)}     |     RC: ${state.runningCount >= 0 ? '+' : ''}${state.runningCount}     |     TC: ${signedRounded(tc, 1)}     |     EDGE: ${signedRounded(adv, 1)}%`,
    recommendation(),
    state.showCheatOnMain?cheatLine:'',
    '\n\n\n\n\n',
    'DBL for menu',
  ];

  return lines.join('\n');
}

function buildMainHudText(): string {
  const disclaimerRemaining = disclaimerRemainingSeconds();
  if (!state.disclaimerAccepted && disclaimerRemaining > 0) {
    return [
      'TRAINING MODE ONLY',
      'Casino use may violate',
      'house rules or state laws',
      '',
      `Cooldown ${disclaimerRemaining}s`,
    ].join('\n');
  }
  if (!state.disclaimerAccepted) {
    return [
      'TRAINING MODE ONLY',
      'Casino use may violate',
      'house rules or state laws',
      '',
      'OK (CLICK)',
    ].join('\n');
  }

  if (state.hudMode === 'MENU') return buildMenuHudText();
  if (state.hudMode === 'DECKS') return buildDeckHudText();
  if (state.hudMode === 'CHEAT') return buildCheatHudText();
  return buildCountHudText();
}

async function pushHudToEvenHub(): Promise<void> {
  if (!bridge || !startupCreated) return;

  const mainContent = buildMainHudText();

  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: MAIN_CONTAINER_ID,
      containerName: MAIN_CONTAINER_NAME,
      contentOffset: 0,
      contentLength: mainContent.length,
      content: mainContent,
    }),
  );
}

async function render(): Promise<void> {
  hudMainPreview.textContent = buildMainHudText();
  publishStatus.textContent = state.publishStatus;
  publishBtn.textContent = state.deployed ? 'Update App' : 'Publish App';

  try {
    await pushHudToEvenHub();
  } catch (error) {
    console.error('Failed to push HUD update to Even Hub:', error);
  }
}

function applyCountEvent(type: CountEventType): void {
  const delta = type === 'LOW' ? 1 : type === 'HIGH' ? -1 : 0;
  state.runningCount += delta;
  state.cardsSeen += 1;
  state.history.push({ type, delta });
  state.lastAction = `Card: ${type}`;
}

function undoLastEvent(): void {
  const last = state.history.pop();
  if (!last) {
    state.lastAction = 'Undo: none';
    return;
  }

  state.runningCount -= last.delta;
  state.cardsSeen = Math.max(0, state.cardsSeen - 1);
  state.lastAction = `Undo: ${last.type}`;
}

function resetShoe(): void {
  state.runningCount = 0;
  state.cardsSeen = 0;
  state.history = [];
  state.lastAction = 'New shoe';
}

function openMenu(): void {
  state.hudMode = 'MENU';
  state.menuIndex = 0;
}

function closeToCount(lastAction: string): void {
  state.hudMode = 'COUNT';
  state.lastAction = lastAction;
}

function cycleMenu(direction: 1 | -1): void {
  const max = MENU_ITEMS.length;
  state.menuIndex = (state.menuIndex + direction + max) % max;
}

function executeMenuAction(): void {
  const item = MENU_ITEMS[state.menuIndex];
  if (item === 'Undo Last Card') {
    undoLastEvent();
    closeToCount(state.lastAction);
    return;
  }
  if (item === 'New Shoe') {
    resetShoe();
    closeToCount(state.lastAction);
    return;
  }
  if (item === 'Adjust Decks') {
    state.hudMode = 'DECKS';
    return;
  }
  if (item === 'Cheat Sheet') {
    state.hudMode = 'CHEAT';
    return;
  }
  closeToCount('Back to count');
}

function applyDeckAdjust(increment: number): void {
  state.decksTotal = clampFloat(state.decksTotal + increment, 1, 8);
  state.lastAction = `Decks set: ${state.decksTotal.toFixed(1)}`;
}

async function applyAction(action: InputAction): Promise<void> {
  if (!state.disclaimerAccepted && disclaimerRemainingSeconds() > 0) {
    state.lastAction = 'Disclaimer cooldown active';
    await render();
    return;
  }
  if (!state.disclaimerAccepted) {
    if (action === 'CLICK') {
      state.disclaimerAccepted = true;
      state.lastAction = 'Disclaimer accepted';
    } else {
      state.lastAction = 'Press click to continue';
    }
    await render();
    return;
  }

  if (state.hudMode === 'COUNT') {
    if (action === 'CLICK') applyCountEvent('LOW');
    if (action === 'UP') applyCountEvent('HIGH');
    if (action === 'DOWN') applyCountEvent('NEUTRAL');
    if (action === 'DOUBLE_CLICK') openMenu();
    await render();
    return;
  }

  if (state.hudMode === 'MENU') {
    if (action === 'UP') cycleMenu(-1);
    if (action === 'DOWN') cycleMenu(1);
    if (action === 'CLICK') executeMenuAction();
    if (action === 'DOUBLE_CLICK') closeToCount('Back to count');
    await render();
    return;
  }

  if (state.hudMode === 'DECKS') {
    if (action === 'UP') applyDeckAdjust(0.5);
    if (action === 'DOWN') applyDeckAdjust(-0.5);
    if (action === 'CLICK' || action === 'DOUBLE_CLICK') closeToCount(state.lastAction);
    decksTotalInput.value = String(state.decksTotal);
    await render();
    return;
  }

  if (action === 'CLICK' || action === 'DOUBLE_CLICK') {
    closeToCount('Back to count');
  }
  await render();
}

function mapEventTypeToAction(eventType: unknown): InputAction | null {
  if (eventType === undefined || eventType === null) return null;

  const normalized = OsEventTypeList.fromJson?.(eventType);
  if (normalized === OsEventTypeList.CLICK_EVENT) return 'CLICK';
  if (normalized === OsEventTypeList.SCROLL_TOP_EVENT) return 'UP';
  if (normalized === OsEventTypeList.SCROLL_BOTTOM_EVENT) return 'DOWN';
  if (normalized === OsEventTypeList.DOUBLE_CLICK_EVENT) return 'DOUBLE_CLICK';

  if (eventType === OsEventTypeList.CLICK_EVENT || eventType === 0) return 'CLICK';
  if (eventType === OsEventTypeList.SCROLL_TOP_EVENT || eventType === 1) return 'UP';
  if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT || eventType === 2) return 'DOWN';
  if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT || eventType === 3) return 'DOUBLE_CLICK';

  const text = String(eventType).toUpperCase();
  if (text.includes('DOUBLE') && text.includes('CLICK')) return 'DOUBLE_CLICK';
  if (text.includes('DOUBLE') && text.includes('TAP')) return 'DOUBLE_CLICK';
  if (text.includes('SCROLL_TOP') || text === 'UP' || text.includes('SWIPE_UP')) return 'UP';
  if (text.includes('SCROLL_BOTTOM') || text === 'DOWN' || text.includes('SWIPE_DOWN')) return 'DOWN';
  if (text.includes('SINGLE') && text.includes('CLICK')) return 'CLICK';
  if (text.includes('SINGLE') && text.includes('TAP')) return 'CLICK';
  if (text.includes('TAP_EVENT') || text === 'TAP') return 'CLICK';
  if (text === 'CLICK' || text.includes('CLICK_EVENT')) return 'CLICK';

  return null;
}

function extractEventType(event: any): unknown {
  return (
    event?.listEvent?.eventType ??
    event?.textEvent?.eventType ??
    event?.sysEvent?.eventType ??
    event?.listEvent?.eventName ??
    event?.textEvent?.eventName ??
    event?.sysEvent?.eventName ??
    event?.listEvent?.type ??
    event?.textEvent?.type ??
    event?.sysEvent?.type ??
    event?.eventType ??
    event?.type ??
    event?.name
  );
}

function appendEventLog(line: string): void {
  eventLines.push(line);
  while (eventLines.length > 8) {
    eventLines.shift();
  }
  eventLog.textContent = eventLines.join('\n');
}

function shouldTreatEmptySysEventAsClick(event: any): boolean {
  const explicitType = extractEventType(event);
  if (mapEventTypeToAction(explicitType)) return false;

  const now = Date.now();
  if (lastResolvedAction === 'DOUBLE_CLICK' && now - lastResolvedActionAt < 350) return false;
  return true;
}

function isDuplicateEvent(event: any, eventLabel: string): boolean {
  const signature = JSON.stringify({
    listEvent: event?.listEvent ?? null,
    textEvent: event?.textEvent ?? null,
    sysEvent: event?.sysEvent ?? null,
    eventType: event?.eventType ?? null,
    type: event?.type ?? null,
  });

  const now = Date.now();
  if (eventLabel === lastEventLabel && signature === lastEventSignature && now - lastEventAt < 140) {
    return true;
  }

  lastEventLabel = eventLabel;
  lastEventSignature = signature;
  lastEventAt = now;
  return false;
}

async function createStartupPage(): Promise<void> {
  if (!bridge) return;

  const mainContent = buildMainHudText();
  const containerPayload = {
    containerTotalNum: 1,
    textObject: [
      new TextContainerProperty({
        xPosition: MAIN_PANEL_X,
        yPosition: 0,
        width: MAIN_PANEL_WIDTH,
        height: 288,
        containerID: MAIN_CONTAINER_ID,
        containerName: MAIN_CONTAINER_NAME,
        content: mainContent,
        isEventCapture: 1,
      }),
    ],
  };

  const result = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(containerPayload));
  startupCreated = result === 0;
  if (startupCreated) {
    return;
  }

  console.warn('createStartUpPageContainer failed with code:', result, 'trying rebuildPageContainer...');
  const rebuildOk = await bridge.rebuildPageContainer(new RebuildPageContainer(containerPayload));
  startupCreated = !!rebuildOk;
  if (!startupCreated) {
    console.warn('rebuildPageContainer also failed');
  }
}

async function publishApp(): Promise<void> {
  if (state.publishStatus === 'RUNNING') {
    publishLog.textContent = 'Publish is already running. Please wait...';
    await render();
    return;
  }

  const configResponse = await fetch(`${CONTROL_URL}/config`, { cache: 'no-store' }).catch(() => null);
  const configBody = (await configResponse?.json().catch(() => null)) as
    | { config?: { appName?: string; github?: { repo?: string } } }
    | null;

  const savedRepoName = (configBody?.config?.github?.repo ?? '').trim();
  const defaultAppName = clampAppName(savedRepoName || configBody?.config?.appName || 'even-g2-blackjack');
  let appName = defaultAppName;

  if (!savedRepoName) {
    const appNameInput = window.prompt(`App name (max ${MAX_APP_NAME_LENGTH} chars):`, defaultAppName);
    appName = clampAppName(appNameInput ?? '');
    if (!appName) {
      publishLog.textContent = 'Publish cancelled: app name is required.';
      await render();
      return;
    }
  }

  state.publishStatus = 'RUNNING';
  publishBtn.disabled = true;
  ehpkBtn.disabled = true;
  publishLog.textContent = `Publishing "${appName}"...`;
  await render();

  try {
    let response = await fetch(`${CONTROL_URL}/publish-app`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appName }),
    });

    let body = (await response.json().catch(() => null)) as
      | { error?: string; logs?: string; code?: string; publishUrl?: string }
      | null;

    if (!response.ok && (body?.code === 'PAT_REQUIRED' || body?.code === 'INVALID_PAT')) {
      const promptText =
        body?.code === 'INVALID_PAT'
          ? 'Saved PAT is invalid. Paste a new GitHub PAT:'
          : 'GitHub PAT required. Paste PAT:';
      const pat = window.prompt(promptText);
      if (!pat || !pat.trim()) {
        throw new Error('Publish cancelled: PAT is required.');
      }
      response = await fetch(`${CONTROL_URL}/publish-app`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appName, pat: pat.trim() }),
      });
      body = (await response.json().catch(() => null)) as
        | { error?: string; logs?: string; publishUrl?: string }
        | null;
    }

    if (!response.ok) {
      if (response.status === 409) {
        state.publishStatus = 'RUNNING';
        publishLog.textContent = 'Publish already running. Please wait for it to complete.';
        await render();
        return;
      }
      throw new Error(body?.error ?? `HTTP ${response.status}`);
    }

    state.publishStatus = 'DONE';
    state.deployed = true;
    publishLog.textContent = `${body?.logs ?? 'Publish complete.'}\n\nPublished URL:\n${body?.publishUrl ?? 'unknown'}`;
  } catch (error) {
    state.publishStatus = 'FAILED';
    publishLog.textContent = `Error: ${String(error)}`;
  } finally {
    publishBtn.disabled = false;
    ehpkBtn.disabled = false;
    await render();
  }
}

async function buildEhpk(): Promise<void> {
  if (state.publishStatus === 'RUNNING' || state.publishStatus === 'REBOOTING' || state.publishStatus === 'PACKING') {
    publishLog.textContent = 'Another operation is in progress. Please wait...';
    await render();
    return;
  }

  const configResponse = await fetch(`${CONTROL_URL}/config`, { cache: 'no-store' }).catch(() => null);
  const configBody = (await configResponse?.json().catch(() => null)) as { config?: { appName?: string } } | null;
  const defaultAppName = clampAppName((configBody?.config?.appName ?? 'even-g2-blackjack').trim() || 'even-g2-blackjack');

  const appNameInput = window.prompt(`App name for .ehpk package (max ${MAX_APP_NAME_LENGTH} chars):`, defaultAppName);
  const appName = clampAppName(appNameInput ?? '');
  if (!appName) {
    publishLog.textContent = 'Build cancelled: app name is required.';
    await render();
    return;
  }

  state.publishStatus = 'PACKING';
  publishBtn.disabled = true;
  ehpkBtn.disabled = true;
  publishLog.textContent = `Building .ehpk for "${appName}"...`;
  await render();

  try {
    const response = await fetch(`${CONTROL_URL}/build-ehpk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appName }),
    });

    const body = (await response.json().catch(() => null)) as
      | { error?: string; logs?: string; outputPath?: string }
      | null;

    if (!response.ok) {
      if (response.status === 409) {
        state.publishStatus = 'PACKING';
        publishLog.textContent = 'EHPK build already running. Please wait for it to finish.';
        await render();
        return;
      }
      throw new Error(body?.error ?? `HTTP ${response.status}`);
    }

    state.publishStatus = 'DONE';
    publishLog.textContent = `${body?.logs ?? 'EHPK build complete.'}\n\nOutput:\n${body?.outputPath ?? 'unknown'}`;
  } catch (error) {
    state.publishStatus = 'FAILED';
    publishLog.textContent = `Error: ${String(error)}`;
  } finally {
    publishBtn.disabled = false;
    ehpkBtn.disabled = false;
    await render();
  }
}

function setKeyboardFallback(): void {
  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      debugToolsVisible = !debugToolsVisible;
      debugToolsFieldset.style.display = debugToolsVisible ? '' : 'none';
      console.log(`[debug-tools] ${debugToolsVisible ? 'shown' : 'hidden'} (${DEV_TOOLS_TOGGLE_SHORTCUT})`);
      return;
    }

    if (event.key === 'Enter') return void applyAction('CLICK');
    if (event.key === 'ArrowUp') return void applyAction('UP');
    if (event.key === 'ArrowDown') return void applyAction('DOWN');
    if (event.key.toLowerCase() === 'd') return void applyAction('DOUBLE_CLICK');
  });
}

async function init(): Promise<void> {
  startupMs = Date.now();
  setKeyboardFallback();

  publishBtn.addEventListener('click', () => void publishApp());
  ehpkBtn.addEventListener('click', () => void buildEhpk());

  decksTotalInput.addEventListener('change', () => {
    state.decksTotal = clampFloat(Number(decksTotalInput.value), 1, 8);
    decksTotalInput.value = String(state.decksTotal);
    state.lastAction = `Decks set: ${state.decksTotal.toFixed(1)}`;
    void render();
  });
  showCheatMainInput.checked = state.showCheatOnMain;
  showCheatMainInput.addEventListener('change', () => {
    state.showCheatOnMain = showCheatMainInput.checked;
    state.lastAction = state.showCheatOnMain ? 'Main cheat: on' : 'Main cheat: off';
    void render();
  });

  try {
    const health = await fetch(`${CONTROL_URL}/health`, { cache: 'no-store' });
    const info = (await health.json().catch(() => null)) as { capabilities?: string[]; version?: string } | null;
    if (!health.ok || !info?.capabilities?.includes(REQUIRED_CONTROL_CAPABILITY)) {
      publishLog.textContent = 'Control server is outdated. Run Run-Even-Sim.cmd to refresh local services.';
    } else {
      publishLog.textContent = `Control server ready (${info.version ?? 'unknown'})`;
    }
  } catch {
    publishLog.textContent = 'Control server not reachable. Run Run-Even-Sim.cmd.';
  }

  try {
    const response = await fetch(`${CONTROL_URL}/config`, { cache: 'no-store' });
    const body = (await response.json().catch(() => null)) as { config?: { git?: { deployed?: boolean } } } | null;
    state.deployed = !!body?.config?.git?.deployed;
  } catch {}

  try {
    bridge = await Promise.race([
      waitForEvenAppBridge(),
      new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('Even bridge timeout')), 5000)),
    ]);

    await createStartupPage();
    const handleHubEvent = (event: any) => {
      const eventType = extractEventType(event);
      let action = mapEventTypeToAction(eventType);

      if (!action && event?.textEvent && !event?.listEvent && !event?.sysEvent) {
        action = 'CLICK';
      }

      if (!action && shouldTreatEmptySysEventAsClick(event)) {
        action = 'CLICK';
      }

      const eventLabel = action ?? 'NONE';
      if (isDuplicateEvent(event, eventLabel)) {
        return;
      }
      appendEventLog(`${new Date().toLocaleTimeString()}  ${eventLabel}`);

      if (action) {
        lastResolvedAction = action;
        lastResolvedActionAt = Date.now();
        console.log('[hub-event]', { action, eventType, event });
        void applyAction(action);
      }
    };

    bridge.onEvenHubEvent((event) => {
      handleHubEvent(event);
    });

    window.addEventListener('evenHubEvent', (event: Event) => {
      const detail = (event as CustomEvent).detail;
      handleHubEvent(detail);
    });
  } catch (error) {
    console.warn('Even bridge not ready, using browser fallback mode:', error);
  }

  window.setInterval(() => {
    if (!state.disclaimerAccepted) {
      void render();
    }
  }, 250);

  await render();
}

void init();
