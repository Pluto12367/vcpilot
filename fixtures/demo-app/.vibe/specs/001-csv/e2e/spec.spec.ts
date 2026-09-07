// 由 vcpilot 生成:验收标准 → E2E 测试。人工可自由修改,改完直接重跑 vcp verify。
import fs from 'node:fs'
import { test, expect } from '@playwright/test'

const BASE = process.env.VCP_BASE_URL || 'http://localhost:3000'
const ART = process.env.VCP_ARTIFACTS_DIR || '.vibe/specs/001-csv/e2e/artifacts'

fs.mkdirSync(ART, { recursive: true })
async function shot(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.screenshot({ path: ART + '/' + name + '.png', fullPage: true })
  const text = await page.evaluate(() => document.body.innerText)
  fs.writeFileSync(ART + '/' + name + '.dom.txt', String(text))
}

test('AC5: 留言板无留言时导出仅含表头行', async ({ page }) => {
  await page.goto(BASE + '/');
  await expect(page.locator('#export-csv')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-csv').click(),
  ]);

  await shot(page, 'AC5');

  const fs = await import('fs');
  const content = fs.readFileSync(await download.path(), 'utf8');
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n').filter(line => line.trim().length > 0);

  expect(lines).toHaveLength(1);
  expect(lines[0].trim()).toBe('id,author,content,created_at');
});

test('AC1: 存在多条留言时可下载 messages.csv', async ({ page }) => {
  await page.request.post(BASE + '/post', {
    form: { name: 'ac1_user_1', text: 'ac1 first message' },
  });
  await page.request.post(BASE + '/post', {
    form: { name: 'ac1_user_2', text: 'ac1 second message' },
  });

  await page.goto(BASE + '/');
  await expect(page.locator('#export-csv')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-csv').click(),
  ]);

  await shot(page, 'AC1');
  expect(download.suggestedFilename()).toBe('messages.csv');
});

test('AC2: 下载文件首行为 CSV 表头', async ({ page }) => {
  await page.goto(BASE + '/');
  await expect(page.locator('#export-csv')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-csv').click(),
  ]);

  await shot(page, 'AC2');

  const fs = await import('fs');
  const content = fs.readFileSync(await download.path(), 'utf8');
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const firstLine = normalized.split('\n').find(line => line.trim().length > 0);

  expect(firstLine?.trim()).toBe('id,author,content,created_at');
});

test('AC3: 导出的 CSV 包含 Alice 的 hello 留言', async ({ page }) => {
  await page.request.post(BASE + '/post', {
    form: { name: 'Alice', text: 'hello' },
  });

  await page.goto(BASE + '/');
  await expect(page.locator('#export-csv')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-csv').click(),
  ]);

  await shot(page, 'AC3');

  const fs = await import('fs');
  const content = fs.readFileSync(await download.path(), 'utf8');
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n').filter(line => line.trim().length > 0);

  const unquote = (value: string) =>
    value.length >= 2 && value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1)
      : value;

  const found = lines.some(line => {
    const cols = line.split(',');
    return cols.length >= 3 && unquote(cols[1]) === 'Alice' && unquote(cols[2]) === 'hello';
  });

  expect(found).toBe(true);
});

test('AC4: 含逗号、引号、换行的字段被正确转义', async ({ page }) => {
  const author = `ac4_author_${Date.now()}`;
  const rawContent = 'He said "hi, there",\nsecond line with 中文';

  await page.request.post(BASE + '/post', {
    form: { name: author, text: rawContent },
  });

  await page.goto(BASE + '/');
  await expect(page.locator('#export-csv')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-csv').click(),
  ]);

  await shot(page, 'AC4');

  const fs = await import('fs');
  const content = fs.readFileSync(await download.path(), 'utf8');
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

  const escapedField = `"${rawContent.replace(/"/g, '""')}"`;

  expect(normalized).toContain(`${author},${escapedField}`);
});

test('AC6: 导出响应包含 text/csv 与 attachment', async ({ page }) => {
  await page.goto(BASE + '/');
  await expect(page.locator('#export-csv')).toBeVisible();

  const responsePromise = page.waitForResponse(response =>
    response.url().includes('/export/messages')
  );

  const [download, response] = await Promise.all([
    page.waitForEvent('download'),
    responsePromise,
    page.locator('#export-csv').click(),
  ]);

  await shot(page, 'AC6');

  const headers = response.headers();
  expect(headers['content-type']).toContain('text/csv');
  expect(headers['content-disposition']).toContain('attachment');
  expect(download.suggestedFilename()).toBe('messages.csv');
});
