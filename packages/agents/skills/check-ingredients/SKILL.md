---
name: check-ingredients
description: Use when evaluating a product ingredient list or safety claim for source-backed health, toxicity, pregnancy/child, regulatory, environmental, allergy, irritation, and finished-product risk context. Trigger for cosmetics, sunscreens, supplements, foods, cleaners, baby products, and similar consumer products.
---

# Check Ingredients

Use this skill to turn an ingredient list into a source-backed safety review.

The goal is not to produce a generic "clean/dirty" score. The goal is to verify the ingredient list, scrutinize claims, separate real hazards from weak signals, and explain the practical risk in plain language.

## Workflow

1. Capture the product facts.
   - Product name, brand, size, country/retailer, link, date checked, and how the ingredient list was obtained.
   - Preserve the raw ingredient text verbatim when available.
   - Create a normalized ingredient list without changing uncertain names. Note typos or likely synonyms separately.

2. Verify the ingredient source.
   - Prefer back-label photos, brand pages, regulatory labels, SDS sheets, official product pages, or retailer pages with complete ingredients.
   - Do not treat marketplace copy as verified if it lacks the full ingredient list.
   - If sources disagree, show the conflict and keep the version provenance clear.

3. Check each ingredient.
   - Role in formula: active, preservative, solvent, emulsifier, fragrance, colorant, pH adjuster, botanical, filler, etc.
   - Human-health flags: endocrine, reproductive/developmental, carcinogenicity, genotoxicity, systemic toxicity, sensitization, irritation, phototoxicity, inhalation, ingestion, and absorption.
   - Pregnancy/child flags when relevant.
   - Environmental flags separately from human-health risk.
   - Whether the flag applies to the raw ingredient, the finished product, or only a specific exposure route.

4. Use source hierarchy.
   - Highest weight: regulators and official scientific committees, including FDA, EU SCCS/SCCP/SCCNFP, ECHA, EFSA, TGA, Health Canada, CIR, OECD/SIDS, NTP, IARC, PubChem/GHS, and official SDS/labeling sources.
   - Medium weight: peer-reviewed papers and systematic reviews.
   - Lower weight: retailer pages, ingredient databases, product-rating apps, brand claims, blogs, and advocacy sites.
   - Browse for current facts, rules, product labels, and regulator positions.

5. Treat Yuka as a model, not an authority.
   - Yuka-style output is useful as a comparison model: identify the accused ingredient, alleged hazard, vulnerable population, evidence type, and precautionary recommendation.
   - Do not use or imply access to a Yuka API.
   - Scrutinize Yuka-like claims against primary sources. Ask: is the claim about this exact ingredient, a close analog, an impurity, a raw-material hazard, animal dosing, or realistic finished-product exposure?

6. Separate hazard from risk.
   - Raw GHS labels are hazard flags, not finished-product verdicts.
   - pH adjusters, preservatives, solvents, and powders can be hazardous as raw materials but acceptable in a formulated product.
   - Impurities can matter even when the parent ingredient is acceptable. Track them explicitly.
   - Animal findings matter, but report dose, route, species, endpoint, and whether regulators used them for a margin of safety.

7. Produce a practical verdict.
   - Say whether it is a reject, watch item, or acceptable candidate under the user's standard.
   - Call out the strongest real concerns first.
   - Avoid false precision when concentrations are unknown.
   - State what would change the verdict, such as confirmed impurity control, actual concentration, a different label, or user-specific allergy/acne/pregnancy constraints.

## Report Shape

For a full review, write:

- Bottom line.
- Product facts and ingredient provenance.
- Raw ingredient text.
- Normalized ingredient list.
- Ingredient-by-ingredient table.
- Concern buckets: hard rejects, pregnancy/children, endocrine/reproductive, irritation/allergy, environmental, data gaps.
- Source notes with links.
- Practical conclusion.

For a quick answer, keep it short:

- `Safe/Watch/Reject`.
- Top 3 reasons.
- Main uncertainty.

## Standards

- Do not invent ingredient lists.
- Do not claim a product is safe for pregnancy, children, disease states, or allergies with medical certainty.
- Do not let one weak source override regulator assessments without explaining why.
- Do not flatten environmental harm into human toxicity.
- Do not equate "chemical" with unsafe or "natural" with safe.
- Prefer metric units when comparing sizes or doses.
- Cite sources used in the answer or report.
