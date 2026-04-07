import type { AddonDef, ProductName } from './pricing-types';

export const ADDON_CATALOG: AddonDef[] = [
  {
    key: 'motor',
    displayName: 'Motor tube',
    printLabel: 'Motor tube',
    unitPrice: 150,
    eligibleProducts: ['Zebra', 'Roller', 'SHANGRILA', 'SkylightHoneycomb'],
  },
  {
    key: 'hub',
    displayName: 'Hub',
    printLabel: 'Hub',
    unitPrice: 240,
    eligibleProducts: ['Zebra', 'Roller', 'SHANGRILA', 'SkylightHoneycomb'],
  },
  {
    key: 'remote',
    displayName: 'SUNNY Remote Control',
    printLabel: 'SUNNY Remote Control',
    unitPrice: 40,
    eligibleProducts: ['Zebra', 'Roller', 'SHANGRILA', 'SkylightHoneycomb'],
  },
  {
    key: 'track6',
    displayName: 'TRACK 6 ft (72")',
    printLabel: 'Track 6 ft',
    unitPrice: 60,
    eligibleProducts: ['Drapery', 'Sheer'],
  },
  {
    key: 'track8',
    displayName: 'TRACK 8 ft (96")',
    printLabel: 'Track 8 ft',
    unitPrice: 80,
    eligibleProducts: ['Drapery', 'Sheer'],
  },
  {
    key: 'track10',
    displayName: 'TRACK 10 ft (120")',
    printLabel: 'Track 10 ft',
    unitPrice: 100,
    eligibleProducts: ['Drapery', 'Sheer'],
  },
  {
    key: 'track12',
    displayName: 'TRACK 12 ft (144")',
    printLabel: 'Track 12 ft',
    unitPrice: 120,
    eligibleProducts: ['Drapery', 'Sheer'],
  },
];

export function getAddonDef(key: string): AddonDef | undefined {
  return ADDON_CATALOG.find((a) => a.key === key);
}

export function getEligibleAddons(products: ProductName[]): AddonDef[] {
  return ADDON_CATALOG.filter(
    (a) =>
      a.eligibleProducts.length === 0 ||
      a.eligibleProducts.some((p) => products.includes(p))
  );
}

export function calcAddonSubtotal(
  addons: { addonKey: string; qty: number }[]
): number {
  return addons.reduce((sum, a) => {
    const def = getAddonDef(a.addonKey);
    return sum + (def ? def.unitPrice * Math.max(1, a.qty) : 0);
  }, 0);
}
