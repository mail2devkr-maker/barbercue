// "View all" under Popular Services (owner report 14 Nov): every service FastQue customers search
// for, each with a FastQue-owned editorial photo (the same approved library apps/web serves at
// fastque.com/editorial). `value` is the real search text sent to salon search, which matches
// Service.name/Service.category — never an invented taxonomy.
const EDITORIAL = 'https://fastque.com/editorial';

export interface ServiceCatalogItem {
  value: string;
  en: string;
  hi: string;
  imageUrl: string;
}

export const SERVICE_CATALOG: readonly ServiceCatalogItem[] = [
  { value: 'Haircut', en: 'Haircut', hi: 'हेयरकट', imageUrl: `${EDITORIAL}/processes/haircut.webp` },
  { value: 'Beard Trim', en: 'Beard Trim', hi: 'दाढ़ी ट्रिम', imageUrl: `${EDITORIAL}/services/beard/beard-grooming.webp` },
  { value: 'Fade', en: 'Fade', hi: 'फेड', imageUrl: `${EDITORIAL}/services/barber/precision-fade.webp` },
  { value: 'Shave', en: 'Shave', hi: 'शेव', imageUrl: `${EDITORIAL}/services/grooming/hot-towel-shave.webp` },
  { value: 'Head Shave', en: 'Head Shave', hi: 'सिर मुंडन', imageUrl: `${EDITORIAL}/services/grooming/head-shave.webp` },
  { value: 'Moustache', en: 'Moustache', hi: 'मूंछ', imageUrl: `${EDITORIAL}/services/grooming/moustache-grooming.webp` },
  { value: 'Undercut', en: 'Undercut', hi: 'अंडरकट', imageUrl: `${EDITORIAL}/services/barber/undercut.webp` },
  { value: 'Buzz Cut', en: 'Buzz Cut', hi: 'बज़ कट', imageUrl: `${EDITORIAL}/services/barber/buzz-cut.webp` },
  { value: 'Hair Styling', en: 'Hair Styling', hi: 'हेयर स्टाइलिंग', imageUrl: `${EDITORIAL}/services/hair/hair-styling.webp` },
  { value: 'Blow Dry', en: 'Blow Dry', hi: 'ब्लो ड्राई', imageUrl: `${EDITORIAL}/services/hair/blowout.webp` },
  { value: 'Hair Spa', en: 'Hair Spa', hi: 'हेयर स्पा', imageUrl: `${EDITORIAL}/services/hair/hair-salon-flagship.webp` },
  { value: 'Facial', en: 'Facial', hi: 'फेशियल', imageUrl: `${EDITORIAL}/services/skincare/facial-flagship.webp` },
  { value: 'Threading', en: 'Threading', hi: 'थ्रेडिंग', imageUrl: `${EDITORIAL}/services/waxing-threading/threading-flagship.webp` },
  { value: 'Waxing', en: 'Waxing', hi: 'वैक्सिंग', imageUrl: `${EDITORIAL}/services/waxing-threading/threading-flagship.webp` },
  { value: 'Manicure', en: 'Manicure', hi: 'मैनीक्योर', imageUrl: `${EDITORIAL}/services/nails/manicure-flagship.webp` },
  { value: 'Nails', en: 'Nails', hi: 'नेल्स', imageUrl: `${EDITORIAL}/services/nails/manicure-flagship.webp` },
  { value: 'Massage', en: 'Massage', hi: 'मसाज', imageUrl: `${EDITORIAL}/services/spa-massage/spa-flagship.webp` },
  { value: 'Spa', en: 'Spa', hi: 'स्पा', imageUrl: `${EDITORIAL}/services/spa-massage/spa-flagship.webp` },
  { value: 'Makeup', en: 'Makeup', hi: 'मेकअप', imageUrl: `${EDITORIAL}/services/makeup/makeup-flagship.webp` },
  { value: 'Bridal', en: 'Bridal', hi: 'ब्राइडल', imageUrl: `${EDITORIAL}/services/bridal/bridal-event.webp` },
  { value: "Women's Haircut", en: "Women's Haircut", hi: 'महिला हेयरकट', imageUrl: `${EDITORIAL}/services/hair/womens-haircut.webp` },
] as const;
