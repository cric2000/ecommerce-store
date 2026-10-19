import type { Product } from '../domain/types.js';

export const seedProducts: readonly Product[] = [
  { id: 'product-1', name: 'Notebook', unitPricePaise: 12500, availableInventory: 50 },
  { id: 'product-2', name: 'Pen', unitPricePaise: 2500, availableInventory: 100 },
  { id: 'product-3', name: 'Mug', unitPricePaise: 19900, availableInventory: 20 },
  { id: 'product-4', name: 'Backpack', unitPricePaise: 149900, availableInventory: 10 },
  { id: 'product-5', name: 'Desk lamp', unitPricePaise: 74900, availableInventory: 1 },
];
