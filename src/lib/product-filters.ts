import type { Product } from "./products";

export type ArchiveProduct = Pick<Product, "id" | "subcategories" | "orientation" | "price">;

type ArchiveFilters = {
  categories: string[];
  orientations: string[];
  minPrice?: number;
  maxPrice?: number;
};

function matchingProducts<T extends ArchiveProduct>(products: T[], filters: ArchiveFilters) {
  return products.filter(
    (product) =>
      (!filters.categories.length ||
        product.subcategories.some((category) => filters.categories.includes(category))) &&
      (!filters.orientations.length ||
        (product.orientation !== null && filters.orientations.includes(product.orientation))) &&
      (filters.minPrice === undefined ||
        (product.price !== null && product.price.amount >= filters.minPrice)) &&
      (filters.maxPrice === undefined ||
        (product.price !== null && product.price.amount <= filters.maxPrice)),
  );
}

export function filterArchiveProducts<T extends ArchiveProduct>(
  products: T[],
  filters: ArchiveFilters,
  page = 1,
) {
  const matches = matchingProducts(products, filters);
  const pages = Math.ceil(matches.length / 20);
  const currentPage = Math.max(1, Math.min(page, pages));
  return {
    products: matches.slice((currentPage - 1) * 20, currentPage * 20),
    total: matches.length,
    page: currentPage,
    pages,
  };
}

export function getArchiveState<T extends ArchiveProduct>(products: T[], params: URLSearchParams) {
  const categories = [...new Set(products.flatMap((product) => product.subcategories))].sort();
  const orientations = [
    ...new Set(products.flatMap((product) => (product.orientation ? [product.orientation] : []))),
  ].sort();
  const prices = products.flatMap((product) => (product.price ? [product.price.amount] : []));
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  let invalidParams = false;

  function selections(name: string, options: string[]) {
    return [...new Set(params.getAll(name))].filter((value) => {
      if (options.includes(value)) return true;
      invalidParams = true;
      return false;
    });
  }

  function integer(name: string, fallback: number) {
    const value = params.get(name);
    if (value === null) return fallback;
    if (params.getAll(name).length > 1) invalidParams = true;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
      invalidParams = true;
      return fallback;
    }
    return Number(value);
  }

  function price(name: string, fallback: number) {
    const value = integer(name, fallback);
    const bounded = Math.max(minPrice, Math.min(value, maxPrice));
    if (value !== bounded) invalidParams = true;
    return bounded;
  }

  let selectedMin = price("minPrice", minPrice);
  let selectedMax = price("maxPrice", maxPrice);
  if (selectedMin > selectedMax) {
    [selectedMin, selectedMax] = [selectedMax, selectedMin];
    invalidParams = true;
  }
  const filters = {
    categories: selections("category", categories),
    orientations: selections("orientation", orientations),
    minPrice: selectedMin > minPrice ? selectedMin : undefined,
    maxPrice: selectedMax < maxPrice ? selectedMax : undefined,
  };
  let page = integer("page", 1);
  if (page < 1) {
    page = 1;
    invalidParams = true;
  }
  const categoryCounts = new Map(categories.map((category) => [category, 0]));
  for (const product of matchingProducts(products, { ...filters, categories: [] })) {
    for (const category of new Set(product.subcategories)) {
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
  }
  const orientationCounts = new Map(orientations.map((orientation) => [orientation, 0]));
  for (const product of matchingProducts(products, { ...filters, orientations: [] })) {
    if (product.orientation) {
      orientationCounts.set(
        product.orientation,
        (orientationCounts.get(product.orientation) ?? 0) + 1,
      );
    }
  }
  return {
    categories,
    orientations,
    categoryCounts,
    orientationCounts,
    minPrice,
    maxPrice,
    filters,
    invalidParams,
    ...filterArchiveProducts(products, filters, page),
  };
}

export function getArchiveParams(filters: ReturnType<typeof getArchiveState>["filters"], page = 1) {
  const params = new URLSearchParams();
  for (const category of filters.categories) params.append("category", category);
  for (const orientation of filters.orientations) params.append("orientation", orientation);
  if (filters.minPrice !== undefined) params.set("minPrice", String(filters.minPrice));
  if (filters.maxPrice !== undefined) params.set("maxPrice", String(filters.maxPrice));
  if (page > 1) params.set("page", String(page));
  return params;
}

export function getPaginationPages(page: number, pages: number): (number | null)[] {
  const numbers = [...new Set([1, page - 1, page, page + 1, pages])]
    .filter((number) => number >= 1 && number <= pages)
    .sort((a, b) => a - b);
  const result: (number | null)[] = [];
  for (const [index, number] of numbers.entries()) {
    if (index > 0 && number - numbers[index - 1] > 1) result.push(null);
    result.push(number);
  }
  return result;
}
