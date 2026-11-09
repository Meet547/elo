import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { PrismaClient } from '@prisma/client';

export async function checkBrowserProduct({ frontend, host, guest, code, request }) {
  const browser = await chromium.launch();
  const database = new PrismaClient();
  try {
    const contexts = await Promise.all([host, guest].map(async participant => {
      const context = await browser.newContext({ reducedMotion: 'reduce' });
      const split = participant.cookie.indexOf('=');
      await context.addCookies([{
        name: participant.cookie.slice(0, split), value: participant.cookie.slice(split + 1),
        url: frontend, httpOnly: true, sameSite: 'Lax',
      }]);
      return context;
    }));
    const [first, second] = await Promise.all(contexts.map(context => context.newPage()));
    const assertFits = async (page, width) => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(overflow <= 1, `Horizontal overflow at ${width}px on ${new URL(page.url()).pathname}: ${overflow}px`);
    };
    const publicContext = await browser.newContext();
    const publicPage = await publicContext.newPage();
    await publicPage.goto(`${frontend}/leaderboard`);
    await expect(publicPage.getByRole('heading', { name: 'Ranked leaderboard' })).toBeVisible();
    await expect(publicPage.getByText('Smoke host', { exact: true })).toBeVisible();
    await publicContext.close();
    await first.goto(`${frontend}/profile`);
    await expect(first.getByRole('heading', { name: 'Smoke host' })).toBeVisible();
    await first.reload();
    await expect(first.getByRole('heading', { name: 'Smoke host' })).toBeVisible();
    for (const width of [360, 390, 768, 1280]) {
      await first.setViewportSize({ width, height: 900 });
      await assertFits(first, width);
    }
    for (const [path, heading] of [['/profile', 'Smoke host'], ['/settings', 'Settings'], ['/table', 'Practice table'], ['/leaderboard', 'Ranked leaderboard']]) {
      await first.goto(`${frontend}${path}`);
      await expect(first.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      const results = await new AxeBuilder({ page: first }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(results.violations.map(violation => ({
        id: violation.id, nodes: violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })),
      })), [], `Axe violations on ${path}`);
    }

    await Promise.all([first.goto(`${frontend}/ranked`), second.goto(`${frontend}/ranked`)]);
    await Promise.all([first, second].map(page => page.waitForURL(`**/live/${code}`)));
    await first.getByRole('button', { name: 'I’m ready', exact: true }).click();
    await expect(first.getByRole('button', { name: 'Confirmed', exact: true })).toBeVisible();
    await second.getByRole('button', { name: 'I’m ready', exact: true }).click();

    let room;
    const read = async () => (await request(`/api/live/${code}`, { cookie: host.cookie })).data.room;
    for (let hand = 1; hand <= 10; hand++) {
      await expect.poll(async () => {
        room = await read();
        return room?.game?.handNo === hand && room.game.phase === 'betting';
      }, { timeout: 10_000 }).toBe(true);
      const acting = room.me === room.game.toAct ? first : second;
      if (hand === 1) {
        const oldHand = room.game.handNo;
        await acting.reload();
        await expect(acting.getByRole('button', { name: 'Fold', exact: true })).toBeEnabled();
        assert.equal((await read()).game.handNo, oldHand);
        for (const width of [360, 390, 768, 1280]) {
          await acting.setViewportSize({ width, height: 900 });
          await assertFits(acting, width);
        }
      }
      await acting.getByRole('button', { name: 'Fold', exact: true }).press('Enter');
    }
    await expect.poll(async () => (await read()).status, { timeout: 10_000 }).toBe('finished');
    room = await read();
    assert.equal(room.ranked.completedHands, 10);
    assert.equal(await database.session.count({ where: { matchId: room.ranked.matchId } }), 2);
    await first.goto(`${frontend}/match/${room.ranked.matchId}`);
    await expect(first.getByRole('heading', { name: 'Ranked match', exact: true })).toBeVisible();
    assert.equal(await first.locator('details').count(), 10);
    console.log('PASS — two-browser ranked readiness, keyboard play, reconnect, ten-hand settlement, record route, four widths and axe checks');
  } finally {
    await browser.close();
    await database.$disconnect();
  }
}
