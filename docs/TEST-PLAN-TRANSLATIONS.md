# Test Plan – Translations
Site: mykitsch.com

> Source document, stored verbatim as the contract this suite automates.
> Coverage mapping lives in `docs/TRACEABILITY.md`; the executed result lives
> in `docs/RUN-REPORT-2026-08-12.md`.

## High Level QA Checklist
- English baseline content is complete and correct across all key pages (nav, footer, homepage, PDP, cart, checkout)
- Switching to French translates navigation, footer, product pages, cart, and checkout
- Switching to German translates all content with correct special characters (ü, ö, ä, ß)
- Switching to Korean renders all content in Hangul without encoding errors
- Switching to Japanese renders all content in hiragana/katakana/kanji without mojibake
- Switching to Spanish translates all content with correct accented characters (á, é, ñ, etc.)
- Switching to Italian translates all content correctly
- No English text strings remain visible when a non-English language is selected (no untranslated fallbacks)
- Special characters and CJK characters render without garbling or replacement characters across all languages
- Translations are consistent across all page types (homepage, PDP, cart, checkout)
- Page meta titles and descriptions are translated for each language (SEO)
- Checkout flow is fully translated for all supported languages

---

## 1. Objective

The objective of this test plan is to verify that all 7 supported languages on mykitsch.com (English, French, German, Korean, Japanese, Spanish, Italian) are fully and correctly implemented across all key user-facing surfaces. This includes navigation, footer, product pages, cart, checkout, and meta content. Special focus is given to character encoding correctness for CJK and accented character languages, and the absence of untranslated English fallback strings in non-English modes.

---

## 2. Scope

**In Scope:**
- English baseline content verification
- Translation completeness for all 7 languages
- Navigation translation (primary nav, mega menu labels, mobile nav)
- Footer translation (section headings, link labels, newsletter text)
- Homepage translation (hero text, banners, section headings)
- Product page (PDP) translation (product title, description, Add to Cart, labels)
- Cart translation (item labels, subtotal, checkout button, messaging)
- Checkout translation (form labels, step headers, error messages, confirmation)
- Special character rendering (umlauts, accents, Hangul, hiragana/katakana/kanji)
- Absence of untranslated English strings in non-English modes
- Translation consistency across page types
- Meta title and meta description translation

**Out of Scope:**
- Translation quality/accuracy review (linguistic review by native speakers)
- Country/currency switching (covered in Countries/Languages test plan)
- SEO ranking impact of translated URLs
- Third-party app translation (e.g., reviews widgets, chat tools) unless integral to the page

---

## 3. Test Environment

- **Site URL:** https://mykitsch.com
- **Browsers:** Chrome (latest), Firefox (latest), Safari (latest)
- **Devices:** Desktop 1920x1080, Mobile 375px
- **Languages:** English, French, German, Korean, Japanese, Spanish, Italian
- **Pages to Test:** Homepage, Navigation, Footer, Any Product Page (PDP), Cart, Checkout (at least step 1)
- **Tools:** Browser DevTools for inspecting meta tags; Chrome language settings for locale simulation

---

## 4. English Baseline Content

### 4.1 Navigation – English
- With English selected, verify all nav items display in English:
  - Primary nav: Hair, Sleep, Accessories, Skin, Shower, Collections, Best Sellers, New, Sale
  - Utility nav: Search, Account, Cart
  - Supplemental: Hair Quiz, Loyalty Rewards, Gift Cards, Collabs

### 4.2 Footer – English
- Verify all footer headings, link labels, newsletter text, and legal links are in English

### 4.3 Homepage – English
- Verify hero text, promotional banners, section headings, and CTAs are in English

### 4.4 Product Page – English
- Verify product title, description, Add to Cart button, size/variant selectors, and review labels are in English

### 4.5 Cart and Checkout – English
- Verify all cart labels, subtotal text, checkout button, and checkout form labels are in English

---

## 5. French Translation (Français)

### 5.1 Navigation – French
- Switch to French
- Verify all primary nav items display in French (e.g., Cheveux for Hair)
- Verify utility nav and supplemental nav items are translated

### 5.2 Footer – French
- Verify footer section headings, link labels, and newsletter text are in French

### 5.3 Homepage – French
- Verify homepage hero text, banners, and section headings display in French

### 5.4 Product Page – French
- Verify product title, description, and Add to Cart button are in French

### 5.5 Cart and Checkout – French
- Verify cart labels and checkout flow are in French
- Verify error messages display in French

### 5.6 No Untranslated Strings – French
- Browse homepage, nav, footer, PDP, and cart in French mode
- Verify no English text strings are visible (no fallback untranslated content)

---

## 6. German Translation (Deutsch)

### 6.1 Navigation and Page Content – German
- Switch to German
- Verify navigation, homepage, PDP, footer, cart, and checkout are in German

### 6.2 Special Character Rendering – German
- Verify the following German special characters render correctly throughout:
  - ü (u-umlaut), ö (o-umlaut), ä (a-umlaut), ß (Eszett)
- Verify no replacement characters (? or ?) appear in place of umlauts

### 6.3 No Untranslated Strings – German
- Browse all key pages in German mode
- Verify no English fallback strings are visible

---

## 7. Korean Translation (한국어)

### 7.1 Navigation and Page Content – Korean
- Switch to Korean
- Verify navigation, homepage, PDP, footer, and cart display Korean Hangul characters

### 7.2 Korean Character Rendering
- Verify all Korean text renders correctly with no garbled, missing, or replacement characters
- Verify fonts support Korean character display

### 7.3 No Untranslated Strings – Korean
- Browse all key pages in Korean mode
- Verify no English fallback text is visible

---

## 8. Japanese Translation (日本語)

### 8.1 Navigation and Page Content – Japanese
- Switch to Japanese
- Verify navigation, homepage, PDP, footer, and cart display Japanese characters

### 8.2 Japanese Character Rendering
- Verify hiragana, katakana, and kanji characters all render correctly
- Verify no mojibake (garbled characters from encoding errors) appears

### 8.3 No Untranslated Strings – Japanese
- Browse all key pages in Japanese mode
- Verify no English fallback text visible

---

## 9. Spanish Translation (Español)

### 9.1 Navigation and Page Content – Spanish
- Switch to Spanish
- Verify all key pages display in Spanish

### 9.2 Special Character Rendering – Spanish
- Verify the following characters render correctly:
  - á, é, í, ó, ú (accented vowels)
  - ñ (enye)
  - ¿ (inverted question mark), ¡ (inverted exclamation)
- Verify no encoding errors for Spanish accents

### 9.3 No Untranslated Strings – Spanish
- Verify no English strings remain when Spanish is selected

---

## 10. Italian Translation (Italiano)

### 10.1 Navigation and Page Content – Italian
- Switch to Italian
- Verify navigation, homepage, PDP, footer, and checkout are in Italian

### 10.2 No Untranslated Strings – Italian
- Verify no English fallback text visible in Italian mode

---

## 11. No Untranslated Strings – Cross-Language

### 11.1 Systematic Check
For each of the 6 non-English languages, perform a visual scan of:
- Main navigation
- Mega menu labels
- Footer section headings and link labels
- Homepage hero, banners, and CTAs
- Any product page title, description, and button labels
- Cart labels and checkout step headers

Document any English strings found in non-English mode as defects.

### 11.2 Dynamic Content
- Verify dynamically loaded content (promotional banners, popups, modals) also respect the selected language

---

## 12. Special Character Rendering – Summary

### 12.1 Cross-Language Character Test
Systematically switch through all 7 languages and verify:
- German: ü, ö, ä, ß render correctly
- French: é, è, ê, à, ç, œ render correctly
- Spanish: á, é, í, ó, ú, ñ render correctly
- Italian: à, è, é, ì, ò, ù render correctly
- Korean: Hangul characters render in the correct font
- Japanese: Hiragana, katakana, kanji render correctly

### 12.2 Font Support
- Verify that fonts used on the site support all character sets for each language
- Verify no system fallback fonts are unexpectedly rendering (which can cause inconsistent appearance)

---

## 13. Translation Consistency Across Pages

### 13.1 Cross-Page Consistency Check
- Switch to French
- Visit: homepage, a category page, a product page, the cart, and the footer
- Verify terminology is consistent across all pages (same translated terms used for the same concepts)

### 13.2 Promotional and Campaign Content
- Verify any active promotional banners or sale content is translated in non-English modes

---

## 14. Meta Title and Description Translation

### 14.1 Meta Title
- Switch to German
- Open the homepage and inspect the page source or browser tab title
- Verify the meta title is in German (not English)

### 14.2 Meta Description
- Switch to French
- Open the homepage source and inspect the meta description tag
- Verify it is in French

### 14.3 Spot-Check Other Languages
- Perform spot-check on meta title/description for Korean and Japanese to confirm non-Latin character meta content is supported

---

## 15. Checkout Translation

### 15.1 Checkout Form Labels
- Switch to French and proceed to checkout
- Verify all form field labels (Name, Address, Email, Phone, Shipping Method) are in French

### 15.2 Checkout Error Messages
- Submit an incomplete checkout form in German
- Verify validation error messages appear in German

### 15.3 Checkout Confirmation
- Complete a checkout in Spanish (or use a test order)
- Verify the order confirmation page displays in Spanish

---

## Final QA Statement

Translation completeness is essential for mykitsch.com to provide a trustworthy and accessible experience for its global customer base across 7 languages. All UI surfaces — navigation, footer, product pages, cart, and checkout — must be fully translated with no English fallback strings appearing in non-English modes. Special character and CJK character encoding must be verified across German, French, Spanish, Italian, Korean, and Japanese to prevent display errors that would undermine brand credibility. Untranslated strings in any non-English mode are High priority defects. Character encoding errors in CJK languages (Korean, Japanese) or accented-character languages are High priority. Missing meta translations are Medium priority.
