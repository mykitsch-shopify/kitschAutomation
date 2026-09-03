/**
 * Seven-locale storefront content bundle.
 *
 * One content model feeds both fixture layers, on purpose:
 *
 *   - the content-layer catalogue (collectors/fixture-translations.ts)
 *   - the mock storefront the render-layer specs browse
 *
 * If those two disagreed, a defect could pass one layer and fail the other
 * for reasons that had nothing to do with the product. Here, a seeded defect
 * appears in the API surface and on the page, exactly as a real one would.
 *
 * The copy is fixture material, not shipped translation. Linguistic quality
 * review stays human — see FRAMEWORK-AND-ROADMAP.md §3.
 */

export type Surface = 'nav' | 'footer' | 'home' | 'pdp' | 'cart' | 'checkout' | 'meta' | 'brand';

export type KeyMeta = {
  readonly key: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly surface: Surface;
};

export const LOCALES = ['en', 'fr', 'de', 'it', 'es', 'ko', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];

const meta = (
  key: string,
  surface: Surface,
  resourceType: string,
  resourceId: string,
): KeyMeta => ({ key, surface, resourceType, resourceId });

const MENU = 'ONLINE_STORE_MENU';
const THEME = 'ONLINE_STORE_THEME_LOCALE_CONTENT';
const PRODUCT = 'PRODUCT';
const PAGE = 'ONLINE_STORE_PAGE';
const POLICY = 'SHOP_POLICY';

export const KEYS: readonly KeyMeta[] = [
  // Navigation — test plan §4.1, §5.1, §6.1, §7.1, §8.1, §9.1, §10.1
  meta('nav.hair', 'nav', MENU, 'gid://shopify/Menu/1'),
  meta('nav.sleep', 'nav', MENU, 'gid://shopify/Menu/1'),
  meta('nav.accessories', 'nav', MENU, 'gid://shopify/Menu/1'),
  meta('nav.skin', 'nav', MENU, 'gid://shopify/Menu/1'),
  meta('nav.shower', 'nav', MENU, 'gid://shopify/Menu/1'),
  meta('nav.collections', 'nav', MENU, 'gid://shopify/Menu/1'),
  meta('nav.best_sellers', 'nav', MENU, 'gid://shopify/Menu/1'),
  meta('nav.new', 'nav', MENU, 'gid://shopify/Menu/1'),
  meta('nav.sale', 'nav', MENU, 'gid://shopify/Menu/1'),
  meta('nav.search', 'nav', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('nav.account', 'nav', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('nav.cart', 'nav', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('nav.hair_quiz', 'nav', MENU, 'gid://shopify/Menu/2'),
  meta('nav.rewards', 'nav', MENU, 'gid://shopify/Menu/2'),
  meta('nav.gift_cards', 'nav', MENU, 'gid://shopify/Menu/2'),

  // Footer — §4.2, §5.2
  meta('footer.heading_help', 'footer', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('footer.heading_shop', 'footer', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('footer.heading_about', 'footer', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('footer.link_contact', 'footer', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('footer.link_shipping', 'footer', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('footer.link_returns', 'footer', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('footer.link_faq', 'footer', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('footer.newsletter_heading', 'footer', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('footer.newsletter_body', 'footer', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('footer.newsletter_cta', 'footer', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('footer.legal_privacy', 'footer', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('shop_policy.terms_of_service', 'footer', POLICY, 'gid://shopify/ShopPolicy/1'),

  // Homepage — §4.3, §5.3
  meta('home.hero_heading', 'home', PAGE, 'gid://shopify/OnlineStorePage/1'),
  meta('home.hero_sub', 'home', PAGE, 'gid://shopify/OnlineStorePage/1'),
  meta('home.hero_cta', 'home', PAGE, 'gid://shopify/OnlineStorePage/1'),
  meta('home.banner_promo', 'home', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('home.section_bestsellers', 'home', PAGE, 'gid://shopify/OnlineStorePage/1'),
  meta('home.section_new', 'home', PAGE, 'gid://shopify/OnlineStorePage/1'),

  // Product page — §4.4, §5.4
  meta('pdp.title', 'pdp', PRODUCT, 'gid://shopify/Product/8801'),
  meta('pdp.description', 'pdp', PRODUCT, 'gid://shopify/Product/8801'),
  meta('pdp.add_to_cart', 'pdp', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('pdp.size_label', 'pdp', 'PRODUCT_OPTION', 'gid://shopify/ProductOption/1'),
  meta('pdp.color_label', 'pdp', 'PRODUCT_OPTION', 'gid://shopify/ProductOption/2'),
  meta('pdp.reviews_label', 'pdp', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('pdp.in_stock', 'pdp', THEME, 'gid://shopify/OnlineStoreTheme/1'),

  // Cart — §4.5, §5.5
  meta('cart.heading', 'cart', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('cart.empty', 'cart', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('cart.subtotal', 'cart', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('cart.checkout_cta', 'cart', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('cart.shipping_note', 'cart', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('cart.remove', 'cart', THEME, 'gid://shopify/OnlineStoreTheme/1'),

  // Checkout — §15
  meta('checkout.heading', 'checkout', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('checkout.contact_email', 'checkout', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('checkout.first_name', 'checkout', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('checkout.last_name', 'checkout', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('checkout.address', 'checkout', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('checkout.city', 'checkout', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('checkout.postal_code', 'checkout', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('checkout.phone', 'checkout', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('checkout.shipping_method', 'checkout', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('checkout.continue_cta', 'checkout', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('checkout.error_required', 'checkout', THEME, 'gid://shopify/OnlineStoreTheme/1'),

  // Meta tags — §14
  meta('meta.home_title', 'meta', PAGE, 'gid://shopify/OnlineStorePage/1'),
  meta('meta.home_description', 'meta', PAGE, 'gid://shopify/OnlineStorePage/1'),
  meta('meta.pdp_title', 'meta', PRODUCT, 'gid://shopify/Product/8801'),
  meta('meta.pdp_description', 'meta', PRODUCT, 'gid://shopify/Product/8801'),

  // Dynamic content — modal and popup surfaces (§11.2)
  meta('modal.close', 'nav', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('modal.language_heading', 'nav', THEME, 'gid://shopify/OnlineStoreTheme/1'),

  // Order confirmation (§15.3)
  meta('confirmation.heading', 'checkout', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('confirmation.order_number', 'checkout', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('confirmation.email_sent', 'checkout', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('confirmation.continue_shopping', 'checkout', THEME, 'gid://shopify/OnlineStoreTheme/1'),

  // Do-not-translate probes — the glossary is only worth having if something
  // exercises it.
  meta('brand.name', 'brand', THEME, 'gid://shopify/OnlineStoreTheme/1'),
  meta('brand.material', 'brand', THEME, 'gid://shopify/OnlineStoreTheme/1'),
];

export type LocaleContent = Readonly<Record<string, string | null>>;

const en: LocaleContent = {
  'nav.hair': 'Hair',
  'nav.sleep': 'Sleep',
  'nav.accessories': 'Accessories',
  'nav.skin': 'Skin',
  'nav.shower': 'Shower',
  'nav.collections': 'Collections',
  'nav.best_sellers': 'Best Sellers',
  'nav.new': 'New',
  'nav.sale': 'Sale',
  'nav.search': 'Search',
  'nav.account': 'Account',
  'nav.cart': 'Cart',
  'nav.hair_quiz': 'Hair Quiz',
  'nav.rewards': 'Loyalty Rewards',
  'nav.gift_cards': 'Gift Cards',

  'footer.heading_help': 'Help',
  'footer.heading_shop': 'Shop',
  'footer.heading_about': 'About',
  'footer.link_contact': 'Contact us',
  'footer.link_shipping': 'Shipping',
  'footer.link_returns': 'Returns and exchanges',
  'footer.link_faq': 'Frequently asked questions',
  'footer.newsletter_heading': 'Join the list',
  'footer.newsletter_body': 'Be first to hear about new arrivals and member-only offers.',
  'footer.newsletter_cta': 'Subscribe',
  'footer.legal_privacy': 'Privacy policy',
  'shop_policy.terms_of_service': 'Terms of Service',

  'home.hero_heading': 'Better hair starts here',
  'home.hero_sub': 'Satin accessories and hair tools designed for healthier hair',
  'home.hero_cta': 'Shop now',
  'home.banner_promo': 'Free shipping on orders over {{ amount }}',
  'home.section_bestsellers': 'Best sellers',
  'home.section_new': 'New arrivals',

  'pdp.title': 'Satin Pillowcase Set',
  'pdp.description':
    'A smoother surface for your hair and skin. Machine washable, available in five colours.',
  'pdp.add_to_cart': 'Add to cart',
  'pdp.size_label': 'Size',
  'pdp.color_label': 'Colour',
  'pdp.reviews_label': '{{ count }} reviews',
  'pdp.in_stock': 'In stock',

  'cart.heading': 'Your cart',
  'cart.empty': 'Your cart is empty',
  'cart.subtotal': 'Subtotal',
  'cart.checkout_cta': 'Checkout',
  'cart.shipping_note': 'Shipping calculated at checkout',
  'cart.remove': 'Remove',

  'checkout.heading': 'Checkout',
  'checkout.contact_email': 'Email',
  'checkout.first_name': 'First name',
  'checkout.last_name': 'Last name',
  'checkout.address': 'Address',
  'checkout.city': 'City',
  'checkout.postal_code': 'Postal code',
  'checkout.phone': 'Phone',
  'checkout.shipping_method': 'Shipping method',
  'checkout.continue_cta': 'Continue to shipping',
  'checkout.error_required': 'This field is required',

  'meta.home_title': 'Kitsch | Hair accessories and satin beauty essentials',
  'meta.home_description':
    'Shop satin pillowcases, scrunchies and hair tools designed for healthier hair. Free shipping on qualifying orders.',
  'meta.pdp_title': 'Satin Pillowcase Set | Kitsch',
  'meta.pdp_description':
    'A satin pillowcase set that is gentler on hair and skin. Machine washable, five colours.',

  'modal.close': 'Close',
  'modal.language_heading': 'Choose your language',
  'confirmation.heading': 'Thank you for your order',
  'confirmation.order_number': 'Order {{ number }}',
  'confirmation.email_sent': 'A confirmation email is on its way to {{ email }}',
  'confirmation.continue_shopping': 'Continue shopping',

  'brand.name': 'Kitsch',
  'brand.material': 'Satin',
};

const fr: LocaleContent = {
  'nav.hair': 'Cheveux',
  'nav.sleep': 'Sommeil',
  'nav.accessories': 'Accessoires',
  'nav.skin': 'Peau',
  'nav.shower': 'Douche',
  'nav.collections': 'Collections',
  'nav.best_sellers': 'Meilleures ventes',
  'nav.new': 'Nouveautés',
  'nav.sale': 'Soldes',
  'nav.search': 'Rechercher',
  'nav.account': 'Compte',
  'nav.cart': 'Panier',
  'nav.hair_quiz': 'Quiz cheveux',
  'nav.rewards': 'Programme de fidélité',
  'nav.gift_cards': 'Cartes cadeaux',

  'footer.heading_help': 'Aide',
  'footer.heading_shop': 'Boutique',
  'footer.heading_about': 'À propos',
  'footer.link_contact': 'Nous contacter',
  'footer.link_shipping': 'Livraison',
  'footer.link_returns': 'Retours et échanges',
  'footer.link_faq': 'Questions fréquentes',
  'footer.newsletter_heading': 'Rejoignez-nous',
  'footer.newsletter_body':
    'Soyez informé en avant-première des nouveautés et des offres réservées aux membres.',
  'footer.newsletter_cta': 'S’inscrire',
  'footer.legal_privacy': 'Politique de confidentialité',
  'shop_policy.terms_of_service': null,

  'home.hero_heading': 'De plus beaux cheveux commencent ici',
  'home.hero_sub': 'Accessoires en satin et outils coiffants pensés pour des cheveux en santé',
  'home.hero_cta': 'Acheter',
  'home.banner_promo': 'Livraison offerte dès {{ amount }} d’achat',
  'home.section_bestsellers': 'Meilleures ventes',
  'home.section_new': 'Nouveautés',

  'pdp.title': 'Ensemble de taies d’oreiller en satin',
  'pdp.description':
    'Une surface plus douce pour vos cheveux et votre peau. Lavable en machine, offert en cinq couleurs.',
  'pdp.add_to_cart': 'Ajouter au panier',
  'pdp.size_label': 'Taille',
  'pdp.color_label': 'Couleur',
  'pdp.reviews_label': '{{ count }} avis',
  'pdp.in_stock': 'En stock',

  'cart.heading': 'Votre panier',
  'cart.empty': 'Votre panier est vide',
  'cart.subtotal': 'Sous-total',
  'cart.checkout_cta': 'Passer la commande',
  'cart.shipping_note': 'Frais de livraison calculés à la commande',
  'cart.remove': 'Retirer',

  'checkout.heading': 'Commande',
  'checkout.contact_email': 'Adresse e-mail',
  'checkout.first_name': 'Prénom',
  'checkout.last_name': 'Nom',
  'checkout.address': 'Adresse',
  'checkout.city': 'Ville',
  'checkout.postal_code': 'Code postal',
  'checkout.phone': 'Téléphone',
  'checkout.shipping_method': 'Mode de livraison',
  'checkout.continue_cta': 'Continuer vers la livraison',
  'checkout.error_required': 'Ce champ est obligatoire',

  'meta.home_title': 'Kitsch | Accessoires cheveux et essentiels beauté en satin',
  'meta.home_description':
    'Découvrez nos taies d’oreiller en satin, chouchous et outils coiffants pensés pour des cheveux en santé. Livraison offerte dès 50 €.',
  'meta.pdp_title': 'Ensemble de taies d’oreiller en satin | Kitsch',
  'meta.pdp_description':
    'Un ensemble de taies d’oreiller en satin, plus doux pour les cheveux et la peau. Lavable en machine, cinq couleurs.',

  'modal.close': 'Fermer',
  'modal.language_heading': 'Choisissez votre langue',
  'confirmation.heading': 'Merci pour votre commande',
  'confirmation.order_number': 'Commande {{ number }}',
  'confirmation.email_sent': 'Un e-mail de confirmation est en route vers {{ email }}',
  'confirmation.continue_shopping': 'Continuer mes achats',

  'brand.name': 'Kitsch',
  'brand.material': 'Satin',
};

const de: LocaleContent = {
  'nav.hair': 'Haare',
  'nav.sleep': 'Schlafen',
  'nav.accessories': 'Zubehör',
  'nav.skin': 'Haut',
  'nav.shower': 'Dusche',
  'nav.collections': 'Kollektionen',
  'nav.best_sellers': 'Bestseller',
  'nav.new': 'Neuheiten',
  'nav.sale': 'Angebote',
  'nav.search': 'Suchen',
  'nav.account': 'Konto',
  'nav.cart': 'Warenkorb',
  'nav.hair_quiz': 'Haar-Quiz',
  'nav.rewards': 'Treueprogramm',
  'nav.gift_cards': 'Geschenkkarten',

  'footer.heading_help': 'Hilfe',
  'footer.heading_shop': 'Shop',
  'footer.heading_about': 'Über uns',
  'footer.link_contact': 'Kontakt',
  'footer.link_shipping': 'Versand',
  'footer.link_returns': 'Rückgabe und Umtausch',
  'footer.link_faq': 'Häufige Fragen',
  'footer.newsletter_heading': 'Newsletter abonnieren',
  'footer.newsletter_body':
    'Erfahren Sie als Erste von Neuheiten und Angeboten nur für Mitglieder.',
  'footer.newsletter_cta': 'Abonnieren',
  'footer.legal_privacy': 'Datenschutzerklärung',
  'shop_policy.terms_of_service': null,

  'home.hero_heading': 'Schöneres Haar beginnt hier',
  'home.hero_sub': 'Satin-Zubehör und Haarwerkzeuge für gesünderes Haar',
  'home.hero_cta': 'Jetzt kaufen',
  'home.banner_promo': 'Kostenloser Versand ab {{ amount }}',
  'home.section_bestsellers': 'Bestseller',
  'home.section_new': 'Neuheiten',

  'pdp.title': 'Satin-Kissenbezug-Set',
  'pdp.description':
    'Eine sanftere Oberfläche für Haare und Haut. Maschinenwaschbar, in fünf Farben erhältlich.',
  'pdp.add_to_cart': 'In den Warenkorb',
  'pdp.size_label': 'Größe',
  'pdp.color_label': 'Farbe',
  'pdp.reviews_label': '{{ count }} Bewertungen',
  'pdp.in_stock': 'Auf Lager',

  'cart.heading': 'Ihr Warenkorb',
  'cart.empty': 'Ihr Warenkorb ist leer',
  'cart.subtotal': 'Zwischensumme',
  'cart.checkout_cta': 'Zur Kasse',
  'cart.shipping_note': 'Versandkosten werden an der Kasse berechnet',
  'cart.remove': 'Entfernen',

  'checkout.heading': 'Kasse',
  'checkout.contact_email': 'E-Mail-Adresse',
  'checkout.first_name': 'Vorname',
  'checkout.last_name': 'Nachname',
  'checkout.address': 'Adresse',
  'checkout.city': 'Stadt',
  'checkout.postal_code': 'Postleitzahl',
  'checkout.phone': 'Telefon',
  'checkout.shipping_method': 'Versandart',
  'checkout.continue_cta': 'Weiter zum Versand',
  'checkout.error_required': 'Dieses Feld ist erforderlich',

  'meta.home_title': 'Kitsch | Haaraccessoires und Satin-Beauty-Essentials',
  'meta.home_description':
    'Entdecken Sie Satin-Kissenbezüge, Haargummis und Haarwerkzeuge für gesünderes Haar. Kostenloser Versand ab 50 €.',
  'meta.pdp_title': 'Satin-Kissenbezug-Set | Kitsch',
  'meta.pdp_description':
    'Ein Satin-Kissenbezug-Set, das sanfter zu Haar und Haut ist. Maschinenwaschbar, fünf Farben.',

  'modal.close': 'Schliessen',
  'modal.language_heading': 'Sprache wählen',
  'confirmation.heading': 'Vielen Dank für Ihre Bestellung',
  'confirmation.order_number': 'Bestellung {{ number }}',
  'confirmation.email_sent': 'Eine Bestätigungs-E-Mail ist unterwegs an {{ email }}',
  'confirmation.continue_shopping': 'Weiter einkaufen',

  'brand.name': 'Kitsch',
  'brand.material': 'Satin',
};

const it: LocaleContent = {
  'nav.hair': 'Capelli',
  'nav.sleep': 'Notte',
  'nav.accessories': 'Accessori',
  'nav.skin': 'Pelle',
  'nav.shower': 'Doccia',
  'nav.collections': 'Collezioni',
  'nav.best_sellers': 'Più venduti',
  'nav.new': 'Novità',
  'nav.sale': 'Saldi',
  'nav.search': 'Cerca',
  'nav.account': 'Account',
  'nav.cart': 'Carrello',
  'nav.hair_quiz': 'Quiz capelli',
  'nav.rewards': 'Programma fedeltà',
  'nav.gift_cards': 'Carte regalo',

  'footer.heading_help': 'Assistenza',
  'footer.heading_shop': 'Negozio',
  'footer.heading_about': 'Chi siamo',
  'footer.link_contact': 'Contattaci',
  'footer.link_shipping': 'Spedizione',
  'footer.link_returns': 'Resi e cambi',
  'footer.link_faq': 'Domande frequenti',
  'footer.newsletter_heading': 'Iscriviti alla newsletter',
  'footer.newsletter_body':
    'Scopri in anteprima le novità e le offerte riservate agli iscritti.',
  'footer.newsletter_cta': 'Iscriviti',
  'footer.legal_privacy': 'Informativa sulla privacy',
  'shop_policy.terms_of_service': null,

  'home.hero_heading': 'Capelli più belli iniziano da qui',
  'home.hero_sub': 'Accessori in raso e strumenti per capelli più sani',
  'home.hero_cta': 'Acquista ora',
  'home.banner_promo': 'Spedizione gratuita per ordini superiori a {{ amount }}',
  'home.section_bestsellers': 'Più venduti',
  'home.section_new': 'Novità',

  'pdp.title': 'Set di federe in raso',
  'pdp.description':
    'Una superficie più delicata per capelli e pelle. Lavabile in lavatrice, disponibile in cinque colori.',
  'pdp.add_to_cart': 'Aggiungi al carrello',
  'pdp.size_label': 'Taglia',
  'pdp.color_label': 'Colore',
  'pdp.reviews_label': '{{ count }} recensioni',
  'pdp.in_stock': 'Disponibile',

  'cart.heading': 'Il tuo carrello',
  'cart.empty': 'Il tuo carrello è vuoto',
  'cart.subtotal': 'Subtotale',
  'cart.checkout_cta': 'Vai alla cassa',
  'cart.shipping_note': 'Spese di spedizione calcolate alla cassa',
  'cart.remove': 'Rimuovi',

  'checkout.heading': 'Cassa',
  'checkout.contact_email': 'Email',
  'checkout.first_name': 'Nome',
  'checkout.last_name': 'Cognome',
  'checkout.address': 'Indirizzo',
  'checkout.city': 'Città',
  'checkout.postal_code': 'CAP',
  'checkout.phone': 'Telefono',
  'checkout.shipping_method': 'Metodo di spedizione',
  'checkout.continue_cta': 'Continua con la spedizione',
  'checkout.error_required': 'Questo campo è obbligatorio',

  'meta.home_title': 'Kitsch | Accessori per capelli ed essenziali beauty in raso',
  'meta.home_description':
    'Scopri federe in raso, elastici e strumenti per capelli più sani. Spedizione gratuita sopra i 50 €.',
  'meta.pdp_title': 'Set di federe in raso | Kitsch',
  'meta.pdp_description':
    'Un set di federe in raso, più delicato su capelli e pelle. Lavabile in lavatrice, cinque colori.',

  'modal.close': 'Chiudi',
  'modal.language_heading': 'Scegli la tua lingua',
  'confirmation.heading': 'Grazie per il tuo ordine',
  'confirmation.order_number': 'Ordine {{ number }}',
  'confirmation.email_sent': 'Un’email di conferma è in arrivo a {{ email }}',
  'confirmation.continue_shopping': 'Continua lo shopping',

  'brand.name': 'Kitsch',
  'brand.material': 'Satin',
};

const es: LocaleContent = {
  'nav.hair': 'Cabello',
  'nav.sleep': 'Descanso',
  'nav.accessories': 'Accesorios',
  'nav.skin': 'Piel',
  'nav.shower': 'Ducha',
  'nav.collections': 'Colecciones',
  'nav.best_sellers': 'Más vendidos',
  'nav.new': 'Novedades',
  'nav.sale': 'Rebajas',
  'nav.search': 'Buscar',
  'nav.account': 'Cuenta',
  'nav.cart': 'Carrito',
  'nav.hair_quiz': 'Test capilar',
  'nav.rewards': 'Programa de fidelidad',
  'nav.gift_cards': 'Tarjetas regalo',

  'footer.heading_help': 'Ayuda',
  'footer.heading_shop': 'Tienda',
  'footer.heading_about': 'Sobre nosotros',
  'footer.link_contact': 'Contacto',
  'footer.link_shipping': 'Envíos',
  'footer.link_returns': 'Devoluciones y cambios',
  'footer.link_faq': 'Preguntas frecuentes',
  'footer.newsletter_heading': 'Únete a la lista',
  'footer.newsletter_body':
    'Entérate antes que nadie de las novedades y las ofertas exclusivas para socios.',
  'footer.newsletter_cta': 'Suscribirse',
  'footer.legal_privacy': 'Política de privacidad',
  'shop_policy.terms_of_service': null,

  'home.hero_heading': 'Un cabello más bonito empieza aquí',
  'home.hero_sub': 'Accesorios de satén y herramientas para un cabello más sano',
  'home.hero_cta': 'Comprar ahora',
  'home.banner_promo': 'Envío gratis en pedidos superiores a {{ amount }}',
  'home.section_bestsellers': 'Más vendidos',
  'home.section_new': 'Novedades',

  'pdp.title': 'Juego de fundas de almohada de satén',
  'pdp.description':
    'Una superficie más suave para tu cabello y tu piel. Lavable a máquina, disponible en cinco colores.',
  'pdp.add_to_cart': 'Añadir al carrito',
  'pdp.size_label': 'Talla',
  'pdp.color_label': 'Color',
  'pdp.reviews_label': '{{ count }} reseñas',
  'pdp.in_stock': 'En stock',

  'cart.heading': 'Tu carrito',
  'cart.empty': 'Tu carrito está vacío',
  'cart.subtotal': 'Subtotal',
  'cart.checkout_cta': 'Finalizar compra',
  'cart.shipping_note': 'Los gastos de envío se calculan al finalizar la compra',
  'cart.remove': 'Quitar',

  'checkout.heading': 'Finalizar compra',
  'checkout.contact_email': 'Correo electrónico',
  'checkout.first_name': 'Nombre',
  'checkout.last_name': 'Apellidos',
  'checkout.address': 'Dirección',
  'checkout.city': 'Ciudad',
  'checkout.postal_code': 'Código postal',
  'checkout.phone': 'Teléfono',
  'checkout.shipping_method': 'Método de envío',
  'checkout.continue_cta': 'Continuar con el envío',
  'checkout.error_required': 'Este campo es obligatorio',

  'meta.home_title': 'Kitsch | Accesorios para el cabello y básicos de belleza en satén',
  'meta.home_description':
    'Descubre fundas de almohada de satén, coleteros y herramientas para un cabello más sano. Envío gratis desde 50 €.',
  'meta.pdp_title': 'Juego de fundas de almohada de satén | Kitsch',
  'meta.pdp_description':
    'Un juego de fundas de almohada de satén, más suave con el cabello y la piel. Lavable a máquina, cinco colores.',

  'modal.close': 'Cerrar',
  'modal.language_heading': 'Elige tu idioma',
  'confirmation.heading': 'Gracias por tu pedido',
  'confirmation.order_number': 'Pedido {{ number }}',
  'confirmation.email_sent': 'Un correo de confirmación está en camino a {{ email }}',
  'confirmation.continue_shopping': 'Seguir comprando',

  'brand.name': 'Kitsch',
  'brand.material': 'Satin',
};

const ko: LocaleContent = {
  'nav.hair': '헤어',
  'nav.sleep': '슬립',
  'nav.accessories': '액세서리',
  'nav.skin': '스킨',
  'nav.shower': '샤워',
  'nav.collections': '컬렉션',
  'nav.best_sellers': '베스트셀러',
  'nav.new': '신상품',
  'nav.sale': '세일',
  'nav.search': '검색',
  'nav.account': '계정',
  'nav.cart': '장바구니',
  'nav.hair_quiz': '헤어 진단',
  'nav.rewards': '리워드 프로그램',
  'nav.gift_cards': '기프트 카드',

  'footer.heading_help': '고객 지원',
  'footer.heading_shop': '쇼핑',
  'footer.heading_about': '브랜드 소개',
  'footer.link_contact': '문의하기',
  'footer.link_shipping': '배송 안내',
  'footer.link_returns': '반품 및 교환',
  'footer.link_faq': '자주 묻는 질문',
  'footer.newsletter_heading': '뉴스레터 구독',
  'footer.newsletter_body': '신상품과 회원 전용 혜택 소식을 가장 먼저 받아보세요.',
  'footer.newsletter_cta': '구독하기',
  'footer.legal_privacy': '개인정보 처리방침',
  'shop_policy.terms_of_service': null,

  'home.hero_heading': '더 건강한 머릿결은 여기서 시작됩니다',
  'home.hero_sub': '건강한 머릿결을 위한 새틴 액세서리와 헤어 툴',
  'home.hero_cta': '지금 쇼핑하기',
  'home.banner_promo': '{{ amount }} 이상 주문 시 무료 배송',
  'home.section_bestsellers': '베스트셀러',
  'home.section_new': '신상품',

  'pdp.title': '새틴 베개 커버 세트',
  'pdp.description':
    '머릿결과 피부에 더 부드러운 표면. 세탁기 사용이 가능하며 다섯 가지 색상으로 제공됩니다.',
  'pdp.add_to_cart': '장바구니에 담기',
  'pdp.size_label': '사이즈',
  'pdp.color_label': '색상',
  'pdp.reviews_label': '리뷰 {{ count }}개',
  'pdp.in_stock': '재고 있음',

  'cart.heading': '장바구니',
  'cart.empty': '장바구니가 비어 있습니다',
  'cart.subtotal': '소계',
  'cart.checkout_cta': '결제하기',
  'cart.shipping_note': '배송비는 결제 시 계산됩니다',
  'cart.remove': '삭제',

  'checkout.heading': '결제',
  'checkout.contact_email': '이메일',
  'checkout.first_name': '이름',
  'checkout.last_name': '성',
  'checkout.address': '주소',
  'checkout.city': '도시',
  'checkout.postal_code': '우편번호',
  'checkout.phone': '전화번호',
  'checkout.shipping_method': '배송 방법',
  'checkout.continue_cta': '배송 정보로 계속',
  'checkout.error_required': '필수 입력 항목입니다',

  'meta.home_title': 'Kitsch | 헤어 액세서리와 새틴 뷰티 essentials',
  'meta.home_description':
    '건강한 머릿결을 위한 새틴 베개 커버, 헤어 타이, 헤어 툴을 만나보세요. 일정 금액 이상 무료 배송.',
  'meta.pdp_title': '새틴 베개 커버 세트 | Kitsch',
  'meta.pdp_description':
    '머릿결과 피부에 더 부드러운 새틴 베개 커버 세트. 세탁기 사용 가능, 다섯 가지 색상.',

  'modal.close': '닫기',
  'modal.language_heading': '언어 선택',
  'confirmation.heading': '주문해 주셔서 감사합니다',
  'confirmation.order_number': '주문 {{ number }}',
  'confirmation.email_sent': '확인 이메일이 {{ email }}(으)로 발송됩니다',
  'confirmation.continue_shopping': '쇼핑 계속하기',

  'brand.name': 'Kitsch',
  'brand.material': 'Satin',
};

const ja: LocaleContent = {
  'nav.hair': 'ヘア',
  'nav.sleep': 'スリープ',
  'nav.accessories': 'アクセサリー',
  'nav.skin': 'スキン',
  'nav.shower': 'シャワー',
  'nav.collections': 'コレクション',
  'nav.best_sellers': 'ベストセラー',
  'nav.new': '新着',
  'nav.sale': 'セール',
  'nav.search': '検索',
  'nav.account': 'アカウント',
  'nav.cart': 'カート',
  'nav.hair_quiz': 'ヘア診断',
  'nav.rewards': 'リワードプログラム',
  'nav.gift_cards': 'ギフトカード',

  'footer.heading_help': 'ヘルプ',
  'footer.heading_shop': 'ショップ',
  'footer.heading_about': 'ブランドについて',
  'footer.link_contact': 'お問い合わせ',
  'footer.link_shipping': '配送について',
  'footer.link_returns': '返品・交換',
  'footer.link_faq': 'よくあるご質問',
  'footer.newsletter_heading': 'ニュースレター登録',
  'footer.newsletter_body': '新商品や会員限定のご案内をいち早くお届けします。',
  'footer.newsletter_cta': '登録する',
  'footer.legal_privacy': 'プライバシーポリシー',
  'shop_policy.terms_of_service': null,

  'home.hero_heading': '美しい髪は、ここから',
  'home.hero_sub': '健やかな髪のためのサテンアクセサリーとヘアツール',
  'home.hero_cta': '今すぐ購入',
  'home.banner_promo': '{{ amount }}以上のご注文で送料無料',
  'home.section_bestsellers': 'ベストセラー',
  'home.section_new': '新着商品',

  'pdp.title': 'サテン枕カバーセット',
  'pdp.description':
    '髪と肌にやさしいなめらかな表面。洗濯機で洗え、5色からお選びいただけます。',
  'pdp.add_to_cart': 'カートに追加',
  'pdp.size_label': 'サイズ',
  'pdp.color_label': 'カラー',
  'pdp.reviews_label': 'レビュー{{ count }}件',
  'pdp.in_stock': '在庫あり',

  'cart.heading': 'カート',
  'cart.empty': 'カートは空です',
  'cart.subtotal': '小計',
  'cart.checkout_cta': 'レジに進む',
  'cart.shipping_note': '送料は決済時に計算されます',
  'cart.remove': '削除',

  'checkout.heading': 'お支払い',
  'checkout.contact_email': 'メールアドレス',
  'checkout.first_name': '名',
  'checkout.last_name': '姓',
  'checkout.address': '住所',
  'checkout.city': '市区町村',
  'checkout.postal_code': '郵便番号',
  'checkout.phone': '電話番号',
  'checkout.shipping_method': '配送方法',
  'checkout.continue_cta': '配送情報へ進む',
  'checkout.error_required': '必須項目です',

  'meta.home_title': 'Kitsch | ヘアアクセサリーとサテンビューティー',
  'meta.home_description':
    '健やかな髪のためのサテン枕カバー、ヘアゴム、ヘアツール。対象注文は送料無料。',
  'meta.pdp_title': 'サテン枕カバーセット | Kitsch',
  'meta.pdp_description':
    '髪と肌にやさしいサテン枕カバーセット。洗濯機で洗え、5色展開。',

  'modal.close': '閉じる',
  'modal.language_heading': '言語を選択',
  'confirmation.heading': 'ご注文ありがとうございます',
  'confirmation.order_number': '注文 {{ number }}',
  'confirmation.email_sent': '確認メールを{{ email }}へお送りします',
  'confirmation.continue_shopping': 'お買い物を続ける',

  'brand.name': 'Kitsch',
  'brand.material': 'Satin',
};

export const CONTENT: Readonly<Record<Locale, LocaleContent>> = { en, fr, de, it, es, ko, ja };

/** Market-formatted price for the launch product, per locale. */
export const PRICE: Readonly<Record<Locale, string>> = {
  en: '$24.00',
  fr: '24,00 €',
  de: '24,00 €',
  it: '24,00 €',
  es: '24,00 €',
  ko: '₩32,000',
  ja: '¥3,600',
};

/** The value substituted into `{{ amount }}` in the promo banner. */
export const FREE_SHIPPING_THRESHOLD: Readonly<Record<Locale, string>> = {
  en: '$50.00',
  fr: '50,00 €',
  de: '50,00 €',
  it: '50,00 €',
  es: '50,00 €',
  ko: '₩70,000',
  ja: '¥7,500',
};

export const LAUNCH_HANDLE = 'satin-pillowcase-set';
