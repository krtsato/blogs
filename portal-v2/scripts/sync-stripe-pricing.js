// 価格定義ファイルを読み込み、Stripe に同期するスクリプト（DRY_RUN デフォルト）。
// 定義ファイル: portal-v2/payment/prices.yaml または prices.json
// 期待構造: { items: [ { articleSlug, currency, amount, unit, name? } ] }

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Stripe from 'stripe';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const priceFileYaml = path.join(rootDir, 'payment', 'prices.yaml');
const priceFileJson = path.join(rootDir, 'payment', 'prices.json');

function loadPrices() {
  if (fs.existsSync(priceFileYaml)) {
    const yaml = requireYaml();
    const data = yaml.load(fs.readFileSync(priceFileYaml, 'utf-8'));
    return data;
  }
  if (fs.existsSync(priceFileJson)) {
    return JSON.parse(fs.readFileSync(priceFileJson, 'utf-8'));
  }
  throw new Error('price definition file not found (payment/prices.yaml or prices.json)');
}

function requireYaml() {
  try {
    return require('js-yaml');
  } catch (e) {
    throw new Error('Install js-yaml to read YAML files: npm i -D js-yaml');
  }
}

function assertPriceItem(item) {
  if (!item.articleSlug || !item.currency || typeof item.amount !== 'number') {
    throw new Error(`invalid price item: ${JSON.stringify(item)}`);
  }
}

function logPlan(items, mode, dryRun) {
  console.log(`Plan (mode=${mode}, DRY_RUN=${dryRun}):`);
  items.forEach((item) => {
    console.log(
      `- product=article:${item.articleSlug} currency=${item.currency} amount=${item.amount} unit=${item.unit ?? ''}`
    );
  });
}

async function main() {
  const cfg = loadPrices();
  const items = cfg.items ?? [];
  items.forEach(assertPriceItem);

  const mode = (process.env.STRIPE_MODE ?? 'live').toLowerCase();
  const stripeKey =
    mode === 'sandbox'
      ? process.env.STRIPE_TEST_SECRET_KEY || process.env.STRIPE_SECRET_KEY_SANDBOX
      : process.env.STRIPE_SECRET_KEY;
  const dryRun = process.env.DRY_RUN !== 'false';

  if (!stripeKey || dryRun) {
    logPlan(items, mode, dryRun);
    if (!stripeKey) console.warn(`STRIPE key is not set for mode=${mode}. Skipping Stripe calls.`);
    return;
  }

  console.log(`Syncing prices to Stripe mode=${mode}, DRY_RUN=${dryRun}`);
  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });
  for (const item of items) {
    const product = await stripe.products.create({
      name: item.name ?? item.articleSlug,
      metadata: { article_slug: item.articleSlug }
    });
    await stripe.prices.create({
      unit_amount: Math.round(item.amount * 100),
      currency: item.currency.toLowerCase(),
      product: product.id,
      nickname: item.name ?? item.articleSlug,
      metadata: { article_slug: item.articleSlug }
    });
    console.log(`synced price for ${item.articleSlug} ${item.currency}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
