// 価格定義をこのファイル内で完結させ、Stripe に同期するスクリプト（DRY_RUN デフォルト）。
// 期待構造: { items: [ { articleSlug, currency, amount, unit, name? } ] }
import process from 'node:process';
import Stripe from 'stripe';

// TODO: 実際の価格をここに定義してください
const PRICES = {
  items: [
    // 例:
    // { articleSlug: 'hello-world', currency: 'JPY', amount: 980, unit: '¥', name: 'Hello World 単品' },
    // { articleSlug: 'hello-world', currency: 'USD', amount: 6.4, unit: '$', name: 'Hello World Single' },
  ]
};

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
  const items = PRICES.items ?? [];
  items.forEach(assertPriceItem);

  const mode = (process.env.STRIPE_MODE ?? 'live').toLowerCase();
  const stripeKey =
    mode === 'sandbox'
      ? process.env.STRIPE_TEST_SECRET_KEY || process.env.STRIPE_SECRET_KEY_SANDBOX
      : process.env.STRIPE_SECRET_KEY;
  const dryRun = process.env.DRY_RUN !== 'false';

  if (items.length === 0) {
    console.warn('PRICES.items is empty. Define prices before running this script.');
    return;
  }

  logPlan(items, mode, dryRun);
  if (!stripeKey) {
    console.warn(`STRIPE key is not set for mode=${mode}. Skipping Stripe calls.`);
    return;
  }
  if (dryRun) {
    console.log('DRY_RUN is true; skipping Stripe API calls.');
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
