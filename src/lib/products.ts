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
  category_data?: { name?: string };
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
  collection: "originals" | "prints" | null;
  categories: string[];
  orientation: string | null;
  images: { id: string; url: string; alt: string }[];
  variations: {
    id: string;
    name: string;
    size: string | null;
    price: Money | null;
    quantity: number;
    inventory: { locationId: string | null; state: string; quantity: number }[];
  }[];
  price: Money | null;
  inStock: boolean;
};

export function normalizeProducts(snapshot: SquareCatalog): Product[] {
  if (!Array.isArray(snapshot.catalog) || !Array.isArray(snapshot.inventory)) {
    throw new Error("Square data must include catalog and inventory arrays.");
  }

  const catalogById = new Map(snapshot.catalog.map((object) => [object.id, object]));
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
      const collection = categories
        .find((name) => /^(originals|prints)$/i.test(name))
        ?.toLowerCase() as "originals" | "prints" | undefined;
      const orientationValue = Object.values(object.custom_attribute_values ?? {}).find(
        (value) => value.name === "Orientation",
      );
      const orientationId = orientationValue?.custom_attribute_definition_id;
      const orientationUid = orientationValue?.selection_uid_values?.[0];
      const orientation =
        orientationId && orientationUid
          ? (orientations.get(orientationId)?.get(orientationUid) ?? null)
          : null;
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
          return {
            id: variation.id,
            name,
            size: /^regular$/i.test(name) ? null : name,
            price: variationData?.price_money ?? null,
            quantity,
            inventory,
          };
        });
      const inStockVariations = variations.filter((variation) => variation.quantity > 0);
      const price =
        inStockVariations
          .filter((variation): variation is typeof variation & { price: Money } =>
            Boolean(variation.price),
          )
          .map((variation) => variation.price)
          .sort((a, b) => a.amount - b.amount)[0] ?? null;

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
        orientation,
        images,
        variations,
        price,
        inStock: inStockVariations.length > 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
