type Money = { amount: number; currency: string };
type VariationObject = {
  id: string;
  is_deleted?: boolean;
  item_variation_data?: {
    name?: string;
    price_money?: Money;
    sellable?: boolean;
  };
};
type CatalogObject = {
  id: string;
  type: string;
  is_deleted?: boolean;
  present_at_all_locations?: boolean;
  present_at_location_ids?: string[];
  absent_at_location_ids?: string[];
  sale_price_data?: {
    item_variation_id?: string;
    sale_price_type?: string;
    amount_money?: Money;
  };
  item_data?: {
    name?: string;
    description?: string;
    description_plaintext?: string;
    variations?: VariationObject[];
    categories?: { id: string }[];
    image_ids?: string[];
    is_archived?: boolean;
  };
  image_data?: { url?: string };
  category_data?: { name?: string; parent_category?: { id?: string } };
  custom_attribute_definition_data?: {
    name?: string;
    selection_config?: { allowed_selections?: { uid: string; name: string }[] };
  };
  custom_attribute_values?: Record<
    string,
    {
      name?: string;
      custom_attribute_definition_id?: string;
      selection_uid_values?: string[];
      boolean_value?: boolean;
    }
  >;
};
type InventoryCount = {
  catalog_object_id: string;
  location_id?: string;
  state: string;
  quantity: string;
};
export type SquareCatalog = {
  catalog: CatalogObject[];
  inventory: InventoryCount[];
};
export type Product = {
  id: string;
  slug: string;
  name: string;
  description: string;
  collection: "originals" | "reproductions" | null;
  categories: string[];
  subcategories: string[];
  orientation: string | null;
  isNew: boolean;
  images: { id: string; url: string; alt: string }[];
  variations: {
    id: string;
    name: string;
    size: string | null;
    price: Money | null;
    regularPrice: Money | null;
    quantity: number;
    inventory: { locationId: string | null; state: string; quantity: number }[];
  }[];
  price: Money | null;
  regularPrice: Money | null;
  inStock: boolean;
};

export function normalizeProducts(snapshot: SquareCatalog): Product[] {
  if (!Array.isArray(snapshot.catalog) || !Array.isArray(snapshot.inventory)) {
    throw new Error("Square data must include catalog and inventory arrays.");
  }

  const catalogById = new Map(snapshot.catalog.map((object) => [object.id, object]));
  const salePrices = new Map<string, Money>();
  for (const object of snapshot.catalog) {
    if (object.type !== "SALE_PRICE" || object.is_deleted) continue;
    const sale = object.sale_price_data;
    // Square returns this object type, but does not document its schema.
    if (
      typeof sale?.item_variation_id !== "string" ||
      !sale.item_variation_id ||
      sale.sale_price_type !== "SALE_PRICE_TYPE_FIXED_AMOUNT" ||
      !sale.amount_money ||
      !Number.isSafeInteger(sale.amount_money.amount) ||
      sale.amount_money.amount < 0 ||
      !/^[A-Z]{3}$/.test(sale.amount_money.currency ?? "")
    ) {
      throw new Error(`Invalid or unsupported Square sale price ${object.id}.`);
    }
    if (
      object.present_at_all_locations === false ||
      object.present_at_location_ids?.length ||
      object.absent_at_location_ids?.length
    ) {
      throw new Error(
        `Location-specific Square sale price ${object.id} requires a storefront location.`,
      );
    }
    if (salePrices.has(sale.item_variation_id)) {
      throw new Error(`Multiple Square sale prices for variation ${sale.item_variation_id}.`);
    }
    salePrices.set(sale.item_variation_id, sale.amount_money);
  }
  const orientations = new Map<string, Map<string, string>>();
  for (const object of snapshot.catalog) {
    const definition = object.custom_attribute_definition_data;
    if (object.type === "CUSTOM_ATTRIBUTE_DEFINITION" && definition?.name === "Orientation") {
      orientations.set(
        object.id,
        new Map(
          (definition.selection_config?.allowed_selections ?? []).map(({ uid, name }) => [
            uid,
            name,
          ]),
        ),
      );
    }
  }

  const inventoryByVariation = new Map<string, Product["variations"][number]["inventory"]>();
  for (const count of snapshot.inventory) {
    const quantity = Number(count.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error(`Invalid inventory quantity for variation ${count.catalog_object_id}.`);
    }
    const counts = inventoryByVariation.get(count.catalog_object_id) ?? [];
    counts.push({
      locationId: count.location_id ?? null,
      state: count.state,
      quantity,
    });
    inventoryByVariation.set(count.catalog_object_id, counts);
  }

  return snapshot.catalog
    .filter(
      (object) =>
        object.type === "ITEM" &&
        !object.is_deleted &&
        !object.item_data?.is_archived &&
        Boolean(object.item_data?.name),
    )
    .map((object) => {
      const item = object.item_data!;
      const description = item.description_plaintext ?? item.description ?? "";
      const categories = (item.categories ?? [])
        .map((category) => catalogById.get(category.id)?.category_data?.name)
        .filter((name): name is string => Boolean(name));
      const categoryPaths = (item.categories ?? []).map(({ id }) => {
        const path: string[] = [];
        const visited = new Set<string>();
        let category = catalogById.get(id);
        while (category?.category_data && !category.is_deleted && !visited.has(category.id)) {
          visited.add(category.id);
          if (category.category_data.name) path.push(category.category_data.name);
          category = catalogById.get(category.category_data.parent_category?.id ?? "");
        }
        return path;
      });
      const collectionName = categoryPaths
        .flat()
        .find((name) => /^(originals|reproductions)$/i.test(name))
        ?.toLowerCase();
      const collection: Product["collection"] =
        collectionName === "originals" ? "originals" : collectionName ? "reproductions" : null;
      const subcategories = [
        ...new Set(
          categoryPaths.flatMap((path) => {
            const root = path.findIndex((name) => name.toLowerCase() === collection);
            return root === -1 ? [] : path.slice(0, root);
          }),
        ),
      ];
      const orientationValue = Object.values(object.custom_attribute_values ?? {}).find(
        (value) => value.name === "Orientation",
      );
      const orientationId = orientationValue?.custom_attribute_definition_id;
      const orientationUid = orientationValue?.selection_uid_values?.[0];
      const orientation =
        orientationId && orientationUid
          ? (orientations.get(orientationId)?.get(orientationUid) ?? null)
          : null;
      const newValue = Object.values(object.custom_attribute_values ?? {}).find(
        (value) => value.name === "New",
      )?.boolean_value;
      if (newValue !== undefined && typeof newValue !== "boolean") {
        throw new Error(`Invalid Square New flag for item ${object.id}.`);
      }
      const images = (item.image_ids ?? [])
        .map((id) => ({
          id,
          url: catalogById.get(id)?.image_data?.url,
          alt: description || item.name!,
        }))
        .filter((image): image is { id: string; url: string; alt: string } => Boolean(image.url));
      const variations = (item.variations ?? [])
        .filter(
          (variation) => !variation.is_deleted && variation.item_variation_data?.sellable !== false,
        )
        .map((variation) => {
          const variationData = variation.item_variation_data;
          const inventory = inventoryByVariation.get(variation.id) ?? [];
          // ponytail: sum all locations until shipping defines a fulfillable location.
          const quantity = inventory
            .filter((count) => count.state === "IN_STOCK")
            .reduce((total, count) => total + count.quantity, 0);
          const name = variationData?.name ?? "Regular";
          const regularPrice = variationData?.price_money ?? null;
          const salePrice = salePrices.get(variation.id);
          if (
            salePrice &&
            (!regularPrice ||
              !Number.isSafeInteger(regularPrice.amount) ||
              regularPrice.amount < 0 ||
              salePrice.currency !== regularPrice.currency ||
              salePrice.amount > regularPrice.amount)
          ) {
            throw new Error(
              `Square sale price does not match the regular price for variation ${variation.id}.`,
            );
          }
          return {
            id: variation.id,
            name,
            size: /^regular$/i.test(name) ? null : name,
            price: salePrice ?? regularPrice,
            regularPrice,
            quantity,
            inventory,
          };
        });
      const inStockVariations = variations.filter((variation) => variation.quantity > 0);
      const cheapestVariation = inStockVariations
        .filter((variation): variation is typeof variation & { price: Money } =>
          Boolean(variation.price),
        )
        .sort((a, b) => a.price.amount - b.price.amount)[0];

      return {
        id: object.id,
        slug: `${
          item
            .name!.toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "item"
        }-${object.id.toLowerCase()}`,
        name: item.name!,
        description,
        collection: collection ?? null,
        categories,
        subcategories,
        orientation,
        isNew: newValue === true,
        images,
        variations,
        price: cheapestVariation?.price ?? null,
        regularPrice: cheapestVariation?.regularPrice ?? null,
        inStock: inStockVariations.length > 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
