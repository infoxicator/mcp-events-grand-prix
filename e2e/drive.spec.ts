import {test, expect} from '@playwright/test';

test.describe('Local-First Drive Mode with On-Demand Room Promotion', () => {
 test('runs solo drive locally with zero server calls, switches to Jev/Autopilot, then promotes on-demand for a joined Strategy Engineer', async ({page, context}) => {
  const errors: string[] = [];
  let roomPosts = 0;
  let wsOpens = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (req) => { if (req.url().includes('/api/rooms') && req.method() === 'POST') roomPosts++; });
  page.on('websocket', () => { wsOpens++; });

  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/?drive&circuit=monza');

  await expect(page.locator('#drive-lobby')).toBeVisible();
  await expect(page.locator('#lobby-pad-badge')).toContainText('Local Race · 0ms');
  await expect(page.locator('#lobby-driver-seg button[data-dmode="human"]')).toHaveClass(/selected/);
  await expect(page.locator('#lobby-eng-seg button[data-emode="mock"]')).toHaveClass(/selected/);

  const startBtn = page.locator('#drive-start-btn');
  await expect(startBtn).toBeEnabled({timeout: 15_000});
  expect(roomPosts).toBe(0);
  expect(wsOpens).toBe(0);

  if (process.env.CAPTURE_DRIVE_SHOTS) {
   await page.screenshot({path: 'test-results/drive-lobby.png'});
  }

  // Start the local race
  await startBtn.click();
  await expect(page.locator('#drive-lobby')).toBeHidden();
  await expect(page.locator('#drive-hud')).toBeVisible();
  await expect(page.locator('#drive-conn-pill')).toHaveText('LOCAL · 0MS');

  // Wait for 5-second lights sequence to complete and racing to start
  await expect.poll(
   () => page.evaluate(() => (window as unknown as {__raceState?: {race: {phase: string}}}).__raceState?.race.phase),
   {timeout: 15_000},
  ).toBe('racing');

  // 1) Drive manually with W + D (0ms local physics)
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1600);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');

  const manualSnap = await page.evaluate(() => {
   const s = (window as unknown as {__raceState: {race: {cars: {a: {speed: number; distance: number}}}; driverMode?: {a: string}}}).__raceState;
   return {speed: s.race.cars.a.speed, dist: s.race.cars.a.distance, mode: s.driverMode?.a};
  });
  expect(manualSnap.mode).toBe('human');
  expect(manualSnap.speed).toBeGreaterThan(15);

  if (process.env.CAPTURE_DRIVE_SHOTS) {
   await page.screenshot({path: 'test-results/drive-manual.png'});
  }

  // 2) Switch live to Jev (AI)
  await page.locator('#drive-mode-switcher button[data-dmode="jev"]').click();
  await expect.poll(
   () => page.evaluate(() => (window as unknown as {__raceState?: {driverMode?: {a: string}; intents: {a: number}}}).__raceState?.driverMode?.a),
  ).toBe('jev');
  await expect.poll(
   () => page.evaluate(() => (window as unknown as {__raceState?: {intents: {a: number}}}).__raceState?.intents.a ?? 0),
   {timeout: 8000},
  ).toBeGreaterThan(0);

  if (process.env.CAPTURE_DRIVE_SHOTS) {
   await page.screenshot({path: 'test-results/drive-jev.png'});
  }

  // 3) Switch live to Autopilot (still 0 server calls / 0 WS)
  await page.locator('#drive-mode-switcher button[data-dmode="autopilot"]').click();
  await expect.poll(
   () => page.evaluate(() => (window as unknown as {__raceState?: {driverMode?: {a: string}}}).__raceState?.driverMode?.a),
  ).toBe('autopilot');
  await expect.poll(
   () => page.evaluate(() => (window as unknown as {__raceState?: {race: {cars: {a: {intent: {reply: string}}}}}}).__raceState?.race.cars.a.intent.reply ?? ''),
   {timeout: 8000},
  ).toContain('Autopilot');
  expect(roomPosts).toBe(0);
  expect(wsOpens).toBe(0);

  // 4) Click ENG: MOCKED -> switches to ENG: JOIN and transparently promotes to a live room
  await page.locator('#drive-eng-pill').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('room'), {timeout: 10_000}).toBeTruthy();
  await expect.poll(
   () => page.evaluate(() => (window as unknown as {__driveDebug: {getMode: () => {local: boolean; engineerMode: string}}}).__driveDebug.getMode()),
   {timeout: 10_000},
  ).toMatchObject({local: false, engineerMode: 'joined'});
  expect(roomPosts).toBe(1);
  expect(wsOpens).toBe(1);

  // Wait for promoted online room to enter racing
  await expect.poll(
   () => page.evaluate(() => (window as unknown as {__raceState?: {race: {phase: string}}}).__raceState?.race.phase),
   {timeout: 15_000},
  ).toBe('racing');

  // Open a second tab as the Joined Strategy Engineer on the promoted room
  const engineerUrl = await page.evaluate(
   () => (window as unknown as {__driveDebug: {getMode: () => {engineerUrl: string}}}).__driveDebug.getMode().engineerUrl,
  );
  const engPage = await context.newPage();
  await engPage.setViewportSize({width: 1440, height: 900});
  await engPage.goto(engineerUrl);
  await expect(engPage.locator('#engineer-console')).toBeVisible({timeout: 15_000});
  await expect(engPage.locator('#eng-driver-badge')).toContainText('AUTOPILOT');

  // Driver cockpit should immediately see Strategy Engineer LIVE connected
  await expect(page.locator('#drive-eng-pill')).toHaveAttribute('data-state', 'connected', {timeout: 10_000});
  await expect(page.locator('#drive-eng-label')).toHaveText('ENG: LIVE');

  // Joined Strategy Engineer transmits "Box · Hard" order over live team radio
  await engPage.locator('#engineer-console button[data-preset="box-hard"]').click();

  if (process.env.CAPTURE_DRIVE_SHOTS) {
   await engPage.screenshot({path: 'test-results/engineer-pitwall.png'});
  }

  // Driver cockpit HUD receives the live Strategy Engineer radio call & flashing BOX THIS LAP badge
  await expect(page.locator('#drive-radio-banner')).toBeVisible({timeout: 8000});
  await expect(page.locator('#drb-source')).toHaveText('LIVE PIT WALL');
  await expect(page.locator('#drb-text')).toContainText('Hard tyres');
  await expect(page.locator('#dst-box')).toBeVisible();

  if (process.env.CAPTURE_DRIVE_SHOTS) {
   await page.screenshot({path: 'test-results/drive-live-radio.png'});
  }

  // 5) Switch engineer back to Mocked Engineer
  await page.locator('#drive-eng-pill').click();
  await expect.poll(
   () => page.evaluate(() => (window as unknown as {__raceState?: {engineerMode?: {a: string}}}).__raceState?.engineerMode?.a),
  ).toBe('mock');
  await expect(page.locator('#drive-eng-label')).toHaveText('ENG: MOCKED');

  await engPage.close();
  expect(errors).toEqual([]);
 });
});
