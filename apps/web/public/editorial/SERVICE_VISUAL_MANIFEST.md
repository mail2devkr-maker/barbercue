# BarberCue Service Visual Manifest

The generation-ready backlog for BarberCue's full beauty/grooming editorial library. This file
covers the **complete target taxonomy** the launch mission specified; `ASSET_PROVENANCE.md` records
what is **actually shipped today** — as of 2026-08-30, 16 real AI-generated photographs (hero, 8
category flagships, bridal/event flagship, owner, 1 equipment still-life, 4 single process shots).
Nothing in this file is a production asset until it has a corresponding row in
`ASSET_PROVENANCE.md` with `source: ai-generated`.

## Shared art direction (prepend to every prompt below)

> Premium editorial photography for BarberCue, a contemporary Indian and global beauty/grooming
> marketplace. Diverse adult customers and professionals — multiple genders, skin tones, hair
> textures, and ages. Realistic skin texture, realistic hair texture, realistic and anatomically
> correct hands/fingers, accurate professional tools. Clean, warm salon environment: ivory, deep
> charcoal, terracotta, warm wood, and restrained brass/gold accents. Warm natural lighting,
> photographic depth of field, professional but approachable mood. No embedded text, no visible
> third-party logos or brand marks, no watermarks. Not a screenshot, not a graphic, not stylized
> illustration — photographic realism. Dignified, safe, non-graphic, non-sexual. No minors unless
> the specific asset is explicitly a kids-haircut asset, generation-policy-compliant, and reviewed
> as such.

## Quality gate (apply before accepting any generated image — see mission §10)

Reject and regenerate on: malformed fingers, duplicated tools, impossible/extra scissors, warped
mirrors, a blade shown contacting unsafe anatomy, floating/unattached equipment, inconsistent
reflections, distorted faces, gibberish signage or fake embedded text, extra limbs, unrealistic
salon geometry, or obviously synthetic/over-glossy skin. Prefer shipping fewer excellent assets over
many defective ones — a rejected generation is not logged here; only accepted, provenance-recorded
assets belong in `ASSET_PROVENANCE.md`.

## Status legend

- ✅ Shipped as a real AI-generated photograph (see `ASSET_PROVENANCE.md`) — a flagship category
  photo or general still-life only, not the specific service variant listed in the tables below.
- 🟡 One representative photo shipped, but not the full item/sequence this row describes.
- ⬜ Not started — no asset of any kind exists.

---

## 1. Barber / Men's grooming — category flagship ✅, 21 service variants ⬜

Flagship shipped: `barber-flagship` — real photo, a barber giving a precision fade
(`services/barber/precision-fade.webp`). Process shot also shipped: `process-haircut` 🟡 (single
haircut moment, used on the booking page banner — not the full consultation→finish sequence below).

| Service | Status | Prompt (append to shared art direction) |
| --- | --- | --- |
| Classic haircut | ⬜ | A barber mid-scissor-cut on a seated adult male customer, side profile, classic short haircut in progress, barber cape visible, editorial barbershop backdrop. |
| Fade | ⬜ | Close-up of a clipper blending a skin-to-length fade on the side of a customer's head, barber's hand steady, natural transition visible, shallow depth of field. |
| Taper | ⬜ | Barber tapering the neckline of a short haircut with clippers, back-of-head three-quarter angle, clean gradient visible. |
| Skin fade | ⬜ | Extreme close-up of a razor-clean skin fade at the temple, catching warm studio light, texture of blended hair clearly visible. |
| Buzz cut | ⬜ | Barber running clippers evenly across the top of a customer's head for a uniform buzz cut, front-facing customer, relaxed expression. |
| Scissor cut | ⬜ | Barber using shears and a comb together on longer top hair, mid-snip, focused expression, classic barbershop mirror station in soft focus behind. |
| Textured crop | ⬜ | Finished textured crop haircut, customer looking into a mirror, tousled matte-finish top, tapered sides. |
| Pompadour | ⬜ | Barber styling a pompadour with a round brush and dryer, hair lifted at the front, editorial angle. |
| Quiff | ⬜ | Finished quiff hairstyle on an adult male customer, three-quarter portrait, natural light. |
| Undercut | ⬜ | Barber clippering a disconnected undercut, longer top hair clipped out of the way, clear length contrast visible. |
| Kids haircut | ⬜ | *(Generation-policy sensitive — see shared art direction's minors clause. If policy does not clearly support this, substitute an abstract icon instead of attempting a real photographic child subject.)* |
| Senior haircut | ⬜ | Barber trimming a senior adult male customer's hair, warm unhurried mood, classic barbershop chair. |
| Beard trim | ⬜ | Barber trimming a full beard with a guarded trimmer, customer seated, cape on, focused close-up on jawline. |
| Beard shaping | ⬜ | Barber using a straight razor to define a sharp beard edge/cheek line, careful precise angle, safe distance from skin visible. |
| Beard fade | ⬜ | Close-up of a gradient beard fade blending into the sideburn, clipper guard visible mid-stroke. |
| Moustache grooming | ⬜ | Barber trimming and combing a moustache with small scissors, extreme close-up, precise detail work. |
| Hot-towel shave | ⬜ | Steaming hot towel being applied to a customer's lower face before a straight-razor shave, calm spa-like barbershop mood. |
| Traditional clean shave | ⬜ | Barber performing a straight-razor shave along the jawline, lather visible, blade angle clearly safe and controlled. |
| Head shave | ⬜ | Barber shaving a customer's head smooth with a safety razor, lather sheen catching the light. |
| Hair wash | ⬜ | Customer reclined at a shampoo basin, barber washing hair, suds and warm water, relaxed closed-eyes expression. |
| Blow-dry / styling | ⬜ | Barber blow-drying and styling a customer's hair with a brush, mid-motion, editorial barbershop lighting. |
| Scalp care | ⬜ | Barber massaging a scalp-care treatment into a customer's scalp, close-up on hands and hairline, calm expression. |

## 2. Hair salon — category flagship ✅, 21 service variants ⬜

Flagship shipped: `hair-flagship` — real photo, a stylist blow-drying a client's hair
(`services/hair/hair-salon-flagship.webp`). Process shot also shipped: `process-hair-color` 🟡
(single foil-application moment, not the full sequence below).

| Service | Status | Prompt |
| --- | --- | --- |
| Women's haircut | ⬜ | Stylist cutting a woman's hair with shears, editorial salon mirror station, focused precise cut in progress. |
| Layered haircut | ⬜ | Stylist sectioning and cutting layers into long hair, visible length gradient, salon cape. |
| Fringe / bangs | ⬜ | Close-up of a stylist trimming a precise fringe with shears, customer's eyes visible just above the cutting line. |
| Blowout | ⬜ | Stylist blow-drying hair with a round brush for volume, hair mid-lift, warm salon lighting. |
| Shampoo + conditioning | ⬜ | Customer reclined at a salon shampoo basin, stylist massaging conditioner through the hair. |
| Hair styling | ⬜ | Stylist finger-styling finished hair with light product, mirror reflection, editorial close crop. |
| Curls / waves | ⬜ | Stylist wrapping a section of hair around a curling iron/wand, visible spiral curl forming. |
| Straight styling | ⬜ | Stylist running a flat iron through a section of hair, smooth straight result trailing behind the iron. |
| Updo | ⬜ | Stylist pinning a finished elegant updo, hands mid-pin, editorial three-quarter angle. |
| Braiding | ⬜ | Close-up of a stylist's hands braiding a section of hair, precise finger placement. |
| Hair color | ⬜ | Colorist applying tint with a brush to a sectioned lock of hair, foil visible nearby, gloves on. |
| Root touch-up | ⬜ | Colorist applying color precisely at the root with a tint brush, clean sectioning clips visible. |
| Global color | ⬜ | Colorist applying all-over color with a bowl and brush, hair fully sectioned into quadrants. |
| Highlights | ⬜ | Colorist weaving foils through sectioned hair, foil packets catching studio light. |
| Balayage | ⬜ | Colorist hand-painting balayage highlights freehand onto a section of hair without foil. |
| Ombré | ⬜ | Finished ombré result, gradient from natural root to lighter ends, editorial portrait. |
| Toner / gloss | ⬜ | Colorist applying a clear gloss toner across pre-lightened hair, sheen visible. |
| Hair spa | ⬜ | Customer under a processing/hood dryer during a relaxing hair-spa treatment, towel draped, calm mood. |
| Deep conditioning | ⬜ | Stylist working a deep-conditioning mask through lengths of hair, close-up on texture and product. |
| Smoothing treatment | ⬜ | Stylist applying a smoothing treatment section by section, flat iron nearby, sleek result forming. |
| Keratin-style salon treatment | ⬜ | Stylist applying a keratin-style treatment with a brush, hair sectioned, non-medical salon framing only. |

## 3. Nails — category flagship ✅, 12 service variants ⬜

Flagship shipped: `nails-flagship` — real photo, a technician filing a client's nails
(`services/nails/manicure-flagship.webp`). Process shot also shipped: `process-manicure` 🟡 (single
filing moment with henna detail, not the full sequence below).

| Service | Status | Prompt |
| --- | --- | --- |
| Manicure | ⬜ | Nail technician shaping a customer's nails at a manicure station, close-up on hands, tools laid out neatly. |
| Pedicure | ⬜ | Nail technician performing a pedicure at a spa pedicure chair/basin, customer's feet soaking, calm setting. |
| Gel manicure | ⬜ | Technician curing gel polish under a UV/LED lamp, hand positioned correctly inside the lamp. |
| Gel pedicure | ⬜ | Technician applying gel polish to toenails, brush precise, pedicure station visible. |
| French manicure | ⬜ | Close-up of a finished classic French-manicure tip being painted, fine brush line visible. |
| Nail polish | ⬜ | Technician painting a solid color polish onto a nail, smooth even stroke. |
| Nail art | ⬜ | Technician hand-painting a fine nail-art detail with a thin brush, magnified close-up. |
| Nail extensions | ⬜ | Technician applying a nail tip/extension, precise application angle, tools organized. |
| Acrylic-style nails | ⬜ | Technician sculpting acrylic-style nail overlay with a brush and product, close editorial crop. |
| Nail shaping | ⬜ | Technician filing a nail into shape, filing tool at a correct safe angle. |
| Cuticle care | ⬜ | Technician gently pushing back cuticles with a proper tool, hand well-lit, careful precise motion. |
| Spa manicure / pedicure | ⬜ | Customer's hands soaking in a spa bowl during a spa-manicure ritual, warm towels nearby. |

## 4. Skincare / Facial (non-medical) — category flagship ✅, 9 service variants ⬜

Flagship shipped: `skincare-flagship` — real photo, an esthetician applying a facial mask
(`services/skincare/facial-flagship.webp`). Process shot also shipped: `process-facial` 🟡 (single
finishing-cream moment, not the full sequence below). No diagnostic or clinical-outcome framing in
any of these — see mission §6/§23 non-medical boundary.

| Service | Status | Prompt |
| --- | --- | --- |
| Classic facial | ⬜ | Esthetician applying cleanser to a customer's face on a facial bed, customer relaxed, eyes closed, warm spa lighting. |
| Cleanup | ⬜ | Esthetician performing a gentle facial cleanup with cotton pads, close-up, calm non-clinical mood. |
| Hydration facial | ⬜ | Esthetician applying a hydrating serum/mask, dewy healthy skin finish, soft light. |
| Brightening facial | ⬜ | Esthetician massaging a brightening treatment into the skin, editorial spa framing. |
| Exfoliation | ⬜ | Esthetician gently exfoliating skin with a soft brush or scrub, relaxed customer. |
| Face mask | ⬜ | Customer relaxing with a facial mask applied, spa robe, calm ambient light, eyes closed. |
| Facial massage | ⬜ | Esthetician performing gentle upward facial-massage strokes, hands clearly on the skin, non-clinical spa framing. |
| Steam stage | ⬜ | Customer under a gentle facial steamer, esthetician nearby, warm mist visible, spa ambience. |
| Moisturizing / finishing stage | ⬜ | Esthetician applying a final moisturizer, customer's skin glowing, treatment-room finish shot. |

## 5. Waxing / Threading — category flagship ✅, 9 service variants ⬜

Flagship shipped: `waxing-threading-flagship` — real photo, eyebrow threading
(`services/waxing-threading/threading-flagship.webp`). Keep tasteful,
non-sexual, service-educational only — no explicit body waxing close-ups.

| Service | Status | Prompt |
| --- | --- | --- |
| Eyebrow threading | ⬜ | Technician threading an eyebrow with cotton thread stretched between hands, precise controlled motion, customer's eyes closed. |
| Eyebrow shaping | ⬜ | Technician shaping a brow with tweezers and a brow brush, close editorial crop. |
| Upper-lip threading | ⬜ | Technician threading the upper lip area, hands positioned correctly, tasteful close crop avoiding an overly clinical angle. |
| Face threading | ⬜ | Technician threading a section of the cheek/jaw area, calm customer expression. |
| Arm waxing | ⬜ | Technician applying wax strip to a forearm at a clean waxing station, tasteful framing. |
| Leg waxing | ⬜ | Technician smoothing a wax strip onto a lower leg at a clean professional station. |
| Underarm waxing | ⬜ | *(Keep strictly tasteful/non-explicit — prefer a wide, dignified station shot over a close body crop, or substitute the general waxing-setup equipment asset instead.)* |
| Facial waxing | ⬜ | Technician applying a small precise wax strip near the brow/lip area, tasteful close crop. |
| General body waxing | ⬜ | Wide shot of a clean, organized waxing station mid-service, professional tasteful framing, no explicit body close-up. |

## 6. Makeup — category flagship ✅, 8 service variants ⬜

Flagship shipped: `makeup-flagship` — real photo, a makeup artist applying blush at a vanity
(`services/makeup/makeup-flagship.webp`).

| Service | Status | Prompt |
| --- | --- | --- |
| Everyday makeup | ⬜ | Makeup artist applying natural everyday makeup with a brush, customer seated at a well-lit vanity mirror. |
| Party makeup | ⬜ | Makeup artist applying bold party-look eyeshadow, editorial mirror-station lighting. |
| Bridal makeup | ⬜ | Makeup artist applying bridal makeup to a seated customer, soft romantic lighting, tasteful editorial framing. |
| Groom grooming | ⬜ | Barber/groomer preparing a groom's hair and beard for an event, sharp finished look, editorial mood. |
| Eye makeup | ⬜ | Close-up of a makeup artist applying eyeshadow with a brush, precise controlled stroke. |
| Lip application | ⬜ | Close-up of a makeup artist applying lipstick with a lip brush, precise controlled application. |
| Complexion / base | ⬜ | Makeup artist blending foundation onto the skin with a sponge, even natural-looking finish. |
| Makeup finishing | ⬜ | Makeup artist applying a final setting spray/powder, finished look, customer smiling gently. |

## 7. Spa / Wellness (non-medical) — category flagship ✅, 8 service variants ⬜

Flagship shipped: `spa-massage-flagship` — real photo, a back massage in a candlelit spa room
(`services/spa-massage/spa-flagship.webp`). No therapeutic/disease-treatment
claims — relaxation framing only, per mission §6/§23.

| Service | Status | Prompt |
| --- | --- | --- |
| Relaxation massage | ⬜ | Massage therapist performing a back massage on a treatment table, calm spa lighting, towel draped appropriately. |
| Head massage | ⬜ | Therapist performing a seated head/scalp massage, customer relaxed, eyes closed. |
| Foot massage | ⬜ | Therapist massaging a customer's foot at a spa station, warm towels nearby. |
| Hand massage | ⬜ | Therapist massaging a customer's hand and forearm, calm spa framing. |
| Hot-stone-style spa imagery | ⬜ | Smooth warm stones arranged along a customer's back on a treatment table, therapist's hands nearby. |
| Body scrub | ⬜ | Therapist applying a body scrub to a customer's shoulder/back, spa treatment-room setting, tasteful framing. |
| Spa relaxation | ⬜ | Customer relaxing in a calm spa lounge area, eyes closed, warm ambient light, robe. |
| Aromatherapy-style ambience | ⬜ | Still-life of an aromatherapy diffuser with soft steam, candles, and neutral spa linens — no people required. |

## 8. Bridal / Event grooming — category flagship ✅, 6 service variants ⬜

Flagship shipped: `bridal-event-flagship` — real photo, a makeup artist finishing a bridal look
(`services/bridal/bridal-event.webp`). Now a real 9th landing category card and search chip (query
`bridal`), in addition to sharing rows with Makeup/Barber below.

| Service | Status | Prompt |
| --- | --- | --- |
| Bridal hair | ⬜ | Stylist finishing an elegant bridal updo, soft romantic light, editorial mirror shot. |
| Bridal makeup | ⬜ | (Shares the Makeup category's "Bridal makeup" row above.) |
| Groom haircut / styling | ⬜ | Barber finishing a sharp event-ready haircut on a groom, editorial barbershop mood. |
| Groom beard styling | ⬜ | Barber precisely shaping a groom's beard edge before an event, focused close-up. |
| Event hairstyling | ⬜ | Stylist finishing an elaborate event hairstyle, editorial full-length mirror framing. |
| Party grooming | ⬜ | Barber applying finishing pomade/style to a customer ahead of an event, sharp confident finished look. |

---

## 9. Equipment library — 1 of ~45 items ✅, ~44 ⬜

Shipped: `barber-equipment-tools` — real photo, a still-life of clippers/shears/comb/beard brush on
a wooden tray (`equipment/barber-tools.webp`), used as a small generic accent on the salon profile's
"Services & pricing" heading. Reuses the same shared art-direction block for the rest; frame each as
a clean, well-lit still-life or in-context product shot on a workstation, never depicting unsafe
handling.

**Barber:** professional clipper · trimmer · scissors/shears · straight-razor setup · combs ·
brushes · barber cape · neck duster · spray bottle · barber chair · mirror/workstation · hot-towel
setup · disinfected tool tray

**Hair:** professional hair dryer · round brush · flat iron · curling iron/wand · sectioning clips ·
color bowl · tint brush · foils · shampoo basin · salon chair · hood/processing dryer · styling
station

**Nails:** manicure station · nail files/buffers · manicure tools · polish bottles · UV/LED nail
lamp · nail drill (shown in professional use only) · pedicure chair/basin

**Skincare:** facial bed · towel setup · facial steamer · bowls/brushes · skincare workstation ·
magnifying lamp

**Waxing/threading:** wax heater · applicators · waxing setup · professional threading spool/setup

**Spa:** massage table · towels · stones · oils · calm treatment-room setup

**Hygiene/safety:** sanitized tools · covered clean towels · workstation cleaning in progress ·
salon sterilization/sanitization equipment

## 10. Process sequences — 0 of 8 full sequences ⬜ (4 single representative shots ✅🟡)

Each sequence below is meant to be 4–6 non-graphic process-moment shots, same shared art direction,
dignified and realistic — not rigid medical instruction. Four categories now have **one** real
representative shot each (not the full sequence):

- **Haircut:** consultation → sectioning → cutting → detailing → styling → finished look. 🟡 One
  shot shipped — `process-haircut` (cutting stage), used on the booking page banner.
- **Fade:** consultation → guideline → blending → edge detailing → finished fade. ⬜
- **Beard:** consultation → trim → shape → detailing → finish. ⬜
- **Hair color:** consultation → sectioning → controlled application → processing ambience →
  rinse/style → result. 🟡 One shot shipped — `process-hair-color` (foil-application stage).
- **Manicure:** preparation → shaping → cuticle care → polish/gel application → finishing. 🟡 One
  shot shipped — `process-manicure` (filing stage).
- **Facial:** cleansing → steam/prep → non-invasive treatment/mask → massage → finishing skincare.
  🟡 One shot shipped — `process-facial` (finishing-cream stage).
- **Makeup:** preparation → complexion → eyes → detail → finishing look. ⬜
- **Waxing/threading:** clean professional setup → service application/action → soothing/finishing
  stage. ⬜

---

## Coverage summary (production assets actually shipped vs. this manifest's full target)

| Category | Flagship shipped | Service variants shipped | Service variants pending |
| --- | --- | --- | --- |
| Barber / men's grooming | 1 (photo) | 0 (1 process shot 🟡) | 21 |
| Hair salon | 1 (photo) | 0 (1 process shot 🟡) | 21 |
| Nails | 1 (photo) | 0 (1 process shot 🟡) | 12 |
| Skincare / facial | 1 (photo) | 0 (1 process shot 🟡) | 9 |
| Waxing / threading | 1 (photo) | 0 | 9 |
| Makeup | 1 (photo) | 0 | 8 |
| Spa / wellness | 1 (photo) | 0 | 8 |
| Bridal / event grooming | 1 (photo) | 0 | 6 |
| Equipment | 1 of ~45 (photo) | — | ~44 |
| Process sequences | 4 single shots 🟡 | — | 8 full sequences (~40 shots) |

Total shipped this launch: **16 production assets**, all `ai-generated` real photographs (hero, 8
category flagships, bridal/event flagship, owner, 1 equipment still-life, 4 single process shots —
see `ASSET_PROVENANCE.md`). The 10 hand-authored `abstract-placeholder` marks from the prior sprint
remain on disk unused; 1 `abstract-placeholder` (`generic-editorial-pattern`) stays in active use as
a truly generic fallback. Zero images were rejected on quality review. This manifest remains the
ready-to-execute backlog for every service variant, equipment item, and full process sequence still
pending.
