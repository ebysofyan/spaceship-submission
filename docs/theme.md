# Spaceship App — Brand Theme Reference

Visual language of <https://www.spaceshipapp.com/> (Spaceship — Global Fulfilment & Shipping
Platform), extracted 2026-11-18 so this project's UI can match it.

**Method:** downloaded the live production bundle (`/assets/index-*.css` 33 KB,
`/assets/index-*.js` 1.1 MB) and counted every literal colour, gradient, font and radius in
the shipped Tailwind output. Counts below are usage hits in the rendered app, i.e. what the
site actually paints, not a guess from a screenshot. Docs: this file only; no runtime code.

**Not included:** the Spaceship logo, imagery, or ABC Favorit font files. Those are their
property — replicate the *system*, not the assets.

---

## 1. Palette

### Brand accents

| Token | Hex | Role | Evidence |
|---|---|---|---|
| `brand-500` | **`#17F082`** | Primary brand green. CTA fill, icons, active dots, borders, `theme-color` meta. | 108 uses; `content="#17f082"`, `bg-[#17f082]` ×14 |
| `brand-600` | `#06E078` | Hover / pressed state of primary green. | 43 uses |
| `brand-700` | `#07713B` | Deep green. Table headers, text that needs contrast on white. | 5 uses, `bg-[#07713b]` thead |
| `brand-50` | `#E8FAF0` | Green wash. Feature/benefit cards on light sections. | 4 uses, `bg-[#e8faf0]` cards |
| `mint` | `#5AEF77` | Gradient start (green side). | 9 uses |
| `cyan` | `#3AE8F6` | Gradient end (cool side). | 7 uses |
| `sky` | `#00ACFC` | Cold accent: gradient stop, illustration fills. | `from-[#00acfc]` |
| `link` | `#0273D3` | Inline text links (underlined). | 7 uses |

### Gradients

The site has no loud gradients on chrome — gradients are confined to accent text and one
soft pastel section wash.

```
/* accent text on dark surfaces (headings, animated keywords) */
linear-gradient(to right, #5AEF77 0%, #3AE8F6 100%)     /* green → cyan */

/* accent text / keyword rotation on light surfaces */
linear-gradient(to right, #00ACFC 0%, #00E470 100%)     /* blue → green */

/* soft section wash, top → bottom */
linear-gradient(to bottom, #BEF9CB 0%, #D3F9FD 50%, #DEEEFF 100%)
```

Applied as `bg-gradient-to-r ... bg-clip-text text-transparent`.

### Neutrals — light

| Token | Hex | Role | Uses |
|---|---|---|---|
| `surface-0` | `#FFFFFF` | Page background, cards, nav. | 55 `bg-white` |
| `surface-1` | `#F6F6F7` | Hover fill, alt chips, secondary button. | 11 |
| `surface-2` | `#F5F6FA` | Section band / card alt. | 12 |
| `surface-3` | `#F3F5F9` | Section band alt. | 11 |
| `surface-4` | `#F0F0F0` | Image placeholder / inert block. | 7 |
| `border` | `#DBDBDB` | Default 1px border. Cardinal rule of the site. | **210** |
| `border-soft` | `#E5E7EB` / `#D5D7DD` / `#D9D9D9` | Secondary dividers, inputs. | 7 / 8 / 6 |
| `text-strong` | `#000000` / `#1A1A1A` | Headings and body copy. | 599 `text-black` |
| `text-body` | `#454545` | Secondary body copy, long-form. | 38 |
| `text-muted` | `#6D737F` | Meta, dates, captions. | 4 |
| `text-faint` | `#999999` | Breadcrumb / disabled. | 6 |

### Neutrals — dark

| Token | Hex | Role | Uses |
|---|---|---|---|
| `dark-0` | `#1A1A1A` | Dark section background (full-bleed bands, CTA blocks). | 21 |
| `dark-1` | `#292A2E` | Dark card on dark section. | 3 |
| `dark-2` | `#2E2E2E` | Dark surface alt. | 8 |
| `on-dark` | `rgba(255,255,255,.70)` | Body copy on dark. | `text-white/70` |
| `on-dark-faint` | `rgba(255,255,255,.50)` | Attribution / meta on dark. | `text-white/50` |

### Contrast (measured)

| Pair | Ratio | Verdict |
|---|---|---|
| `#000` on `#17F082` | 13.8:1 | AAA — this is why CTA labels are **black**, never white |
| `#FFF` on `#17F082` | 1.5:1 | **Fail — never put white text on brand green** |
| `#FFF` on `#07713B` | 6.1:1 | AA |
| `#454545` on `#FFF` | 9.6:1 | AAA |
| `#6D737F` on `#FFF` | 4.8:1 | AA |
| `#17F082` on `#1A1A1A` | 11.5:1 | AAA |

---

## 2. Typography

**Family:** `ABC Favorit` (Regular 400 / Medium 500 / Bold 700) for UI and body;
`ABC Favorit Extended` (same weights) for display headings. Grotesque, tight, geometric.

ABC Favorit is a commercial Dinamo licence and the `.otf` files are **not** redistributable.
Substitute and lock the metrics:

```css
--font-sans: "Inter Tight", "Inter", ui-sans-serif, system-ui, sans-serif;
--font-display: var(--font-sans);   /* headings differ by weight + tracking, not family */
```

Emit headings at weight 700 with `letter-spacing: -0.02em`; body at 400.

**Sizes actually used** (px): 12, 13, 14, 15, **16 (base)**, 18, 20, 22, 24, 26, 28, 32, 34,
36, 38, **40 (hero h2)**, 44, 48. Default body line-height 22–24 px; headings 1.1–1.2.

Rule of the site: headings are bold, huge, black, and short. Body is 16 px regular `#454545`
with generous line-height. Never light weights.

---

## 3. Shape, depth, layout

| Property | Value |
|---|---|
| Radius — control | `8px` (buttons, nav items, inputs) |
| Radius — small card | `12px` (dropdowns, tiles) |
| Radius — card | `20px` (primary card radius, 45 uses) |
| Radius — panel | `24px` |
| Radius — pill | `60px` / `rounded-full` (badges, nav pills) |
| Shadow | `0 8px 32px rgba(0,0,0,0.12)` — dropdowns/floating only; cards use 1px borders, not shadow |
| Borders | Always `1px solid #DBDBDB`, including tables and cards |
| Container | `max-width: 1160px`, padding `16px` → `32px` (sm) → `64px` (lg) |
| Section rhythm | `py-16` / `py-24` (`64px` / `96px`) |
| Button height | `36px` (compact), `40px` (nav CTA), `44px` (`h-11`, forms) |

Density is airy on marketing sections, compact inside product chrome (14 px labels,
`h-9`/`h-10` controls).

---

## 4. Component specs

**Primary button**
```css
background: #17F082;
color: #000000;              /* mandatory */
font-weight: 700;
font-size: 13–14px;
height: 36–40px;
padding: 0 12–16px;
border-radius: 8px;
transition: background-color 150ms;
/* hover */ background: #06E078;
```

**Secondary / ghost button** — transparent, `color:#000`, hover `background:#F6F6F7`,
radius 8–12 px, no border on light; on dark: `background: rgba(255,255,255,.15)`.

**Card (light)** — `#FFF`, `1px solid #DBDBDB`, radius 20 px, padding 24 px, no shadow.

**Card (dark)** — `#292A2E`, radius 20 px, padding 24 px, heading in the green→cyan gradient
clip, body `rgba(255,255,255,.70)`.

**Feature card (tinted)** — `#E8FAF0`, radius 20 px, padding 24 px, min-height ~316 px.

**Table** — `border-separate`, 1 px `#DBDBDB` top/left, header row `#07713B` with white bold
16 px cells, body cells 16 px `#454545`, generous `py-4 px-6`.

**Nav** — white, sticky, 64 px tall, `1px` bottom border, black 14–15 px items, hover
`#F6F6F7` pill; CTA is the primary button at `h-10`. Dropdowns: white, radius 12, the shadow
above.

**Badge / pill** — `rounded-full`, 12–13 px bold, `#17F082` bg with black text, or
`#E8FAF0` bg with `#07713B` text.

**Focus ring** — not styled on the live site; use `outline: 2px solid #0273D3; offset: 2px`
for accessibility. Do not use brand green for focus on white (too low contrast against the
page).

---

## 5. Ready-to-paste tokens

### CSS custom properties

```css
:root {
  /* brand */
  --brand-50:  #E8FAF0;
  --brand-500: #17F082;
  --brand-600: #06E078;
  --brand-700: #07713B;
  --mint:      #5AEF77;
  --cyan:      #3AE8F6;
  --sky:       #00ACFC;
  --link:      #0273D3;

  /* light neutrals */
  --surface-0: #FFFFFF;
  --surface-1: #F6F6F7;
  --surface-2: #F5F6FA;
  --surface-3: #F3F5F9;
  --surface-4: #F0F0F0;
  --border:    #DBDBDB;
  --border-soft: #E5E7EB;

  /* text */
  --text-strong: #000000;
  --text-body:   #454545;
  --text-muted:  #6D737F;
  --text-faint:  #999999;

  /* dark */
  --dark-0: #1A1A1A;
  --dark-1: #292A2E;
  --dark-2: #2E2E2E;

  /* support */
  --on-brand: #000000;
  --grad-warm: linear-gradient(to right, #00ACFC 0%, #00E470 100%);
  --grad-cool: linear-gradient(to right, #5AEF77 0%, #3AE8F6 100%);
  --wash:      linear-gradient(to bottom, #BEF9CB 0%, #D3F9FD 50%, #DEEEFF 100%);
  --shadow-float: 0 8px 32px rgba(0,0,0,.12);

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 20px;
  --radius-xl: 24px;

  --font-sans: "Inter Tight", "Inter", ui-sans-serif, system-ui, sans-serif;
}
```

### Tailwind v4 (`@theme`)

```css
@theme {
  --color-brand-50:  #E8FAF0;
  --color-brand-500: #17F082;
  --color-brand-600: #06E078;
  --color-brand-700: #07713B;
  --color-mint: #5AEF77;
  --color-cyan: #3AE8F6;
  --color-sky:  #00ACFC;
  --color-link: #0273D3;

  --color-surface: #FFFFFF;
  --color-subtle:  #F6F6F7;
  --color-band:    #F5F6FA;
  --color-line:    #DBDBDB;

  --color-ink:   #000000;
  --color-body:  #454545;
  --color-muted: #6D737F;

  --color-dark-0: #1A1A1A;
  --color-dark-1: #292A2E;

  --radius-control: 8px;
  --radius-card:    20px;
  --shadow-float:   0 8px 32px rgba(0,0,0,.12);
  --font-sans: "Inter Tight", "Inter", ui-sans-serif, system-ui, sans-serif;
}
```

---

## 6. Applying it to this dashboard

Spaceship is a logistics brand, so the theme is already on-brief — apply it as-is, with one
product-UI adjustment the marketing site does not need:

- **Charts** — categorical series in this order: `#17F082`, `#00ACFC`, `#5AEF77`, `#3AE8F6`,
  `#07713B`, `#6D737F`, then `#DBDBDB` for "other". Status semantics: on-time `#17F082`,
  delayed/danger `#E5484D` (Spaceship publishes no error red; use a conventional one and
  keep it out of the brand slots), neutral `#999999`.
- **Gridlines/baselines** `#DBDBDB`, axis labels `#6D737F` at 12 px, no chart borders or
  background fills — the site's flat, bordered-card look carries the structure.
- **Density** — marketing spacing (`py-24`) is too loose for an analytics grid; keep the
  card style (white, 1 px `#DBDBDB`, radius 20 px) but use 16–24 px padding inside cards and
  a 1160 px max-width content column.
- **Do** reuse the primary button verbatim (green fill, black bold label, `#06E078` hover).
  It is the single most recognisable branding element on the site.
- **Don't** put text in brand green on white (1.4:1), or white on brand green (1.5:1). Use
  `#07713B` on light, `#17F082` only on `#1A1A1A`.
- **Don't** copy the logo, hero art, photography, or the ABC Favorit font files.
