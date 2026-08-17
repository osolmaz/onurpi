---
name: online-shopping
description: Use when researching products to buy online, comparing listings, checking price history, verifying discounts, normalizing unit prices, evaluating sale timing, and deciding whether to buy now or wait across Amazon, Shopee, Woot, manufacturer stores, and other retailers.
---

# Online Shopping

Use this skill to decide whether an online listing is real, comparable, and worth buying.

The goal is not to find the first cheap link. The goal is to verify the exact product, compare true prices, account for sale history, and give a practical buy/wait recommendation with evidence.

## Workflow

1. Identify the exact product.
   - Capture brand, model, generation, storage/size/color, region, condition, warranty, seller, and marketplace.
   - For electronics, verify model numbers and release generation. Similar names can hide different products.
   - For consumables, verify size, count, concentration, package quantity, and expiry/shelf-life if relevant.

2. Verify listing quality.
   - Prefer manufacturer pages, official stores, Amazon listings with ASINs, retailer pages, and clear marketplace seller pages.
   - Treat marketplace listings cautiously when the seller, condition, variant, warranty, or ingredient/spec list is unclear.
   - Preserve links and note whether the listing is sold by the platform, sold by a third party, or fulfilled by the platform.

3. Normalize prices.
   - Use the user's requested currency and metric units when possible.
   - Convert package prices into useful comparison units: per kg, per L, per count, per dose, per TB, per Wh, or per year of warranty.
   - Include shipping, tax, import duties, coupons, membership requirements, and store credits when visible.
   - Separate real cash price from trade-in, gift-card, financing, or bank-card offers.

4. Check price history.
   - Use CamelCamelCamel, Keepa, retailer history, deal posts, archived pages, and news/deal sites when relevant.
   - For Amazon, capture ASIN-specific history when possible.
   - Daily granularity is usually enough; do not imply hour-by-hour precision unless the source provides it.
   - Track price before, during, and after sale windows when the question is about sale timing.

5. Scrutinize discounts.
   - Do not trust list price or MSRP alone.
   - Compare against recent street price, historical low, average price, and competing retailers.
   - Watch for fake discounts, old-generation clearance, renewed/refurbished substitutions, and bundle changes.

6. Compare stores.
   - Check Amazon, Shopee, Woot, official stores, major local retailers, and reputable specialist stores as appropriate.
   - Keep store-specific caveats visible: return policy, warranty region, seller rating, authenticity risk, delivery time, and cancellation risk.
   - Do not treat Woot or marketplace clearance as identical to a current official-retail offer unless condition and warranty match.

7. Recommend an action.
   - Use `buy now`, `wait`, `only buy below X`, or `avoid`.
   - Explain the trigger price and why.
   - State what evidence would change the recommendation, such as a new sale date, confirmed coupon, better warranty, or lower historical low.

## Sale Timing Checks

For events like Prime Day, 6.6, 7.7, 11.11, Black Friday, or end-of-June sales:

- Build a table by event window.
- Include price before the event, lowest price during the event, price after the event, and the observed drop.
- Use exact dates when available.
- Say when data is missing, blocked, seller-specific, or not comparable.

Example shape:

| Event window | Price before | Lowest during | Price after | Drop | Notes |
|---|---:|---:|---:|---:|---|

## Report Shape

For a full answer, include:

- Exact product identity.
- Best current links.
- Normalized price table.
- Historical price table.
- Sale-pattern read.
- Risks and caveats.
- Buy/wait verdict.

For a quick answer, include:

- Best current price.
- Historical low or recent low.
- Buy/wait verdict.
- One sentence on uncertainty.

## Standards

- Browse for current prices, availability, sale dates, and retailer terms.
- Do not invent price history when chart data is blocked.
- Do not compare different variants as if they are the same product.
- Do not hide membership, coupon, trade-in, refurbished, or warranty caveats.
- Prefer metric units when comparing physical goods.
- Cite the pages used.
