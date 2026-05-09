import express from "express";

const normalizeBaseLabel = (value) => {
  const clean = String(value || "")
    .replace(/^BASE\s*[-:]?\s*/i, "")
    .trim()
    .replace(/\s+/g, " ");

  return clean || "Tradicional";
};

const normalizeBaseKey = (value) =>
  normalizeBaseLabel(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const sizeOrder = ["S", "M", "L", "XL", "XXL", "ST"];

const sortSizes = (sizes) =>
  [...new Set((Array.isArray(sizes) ? sizes : []).filter(Boolean))].sort(
    (left, right) => {
      const leftIndex = sizeOrder.indexOf(left);
      const rightIndex = sizeOrder.indexOf(right);
      return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
    }
  );

const getPriceObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const priceNumber = (value) => {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const getBaseNameFromPizza = (pizza) =>
  normalizeBaseLabel(pizza.cookingMethod || pizza.category || "Tradicional");

const zeroStockForBase = async (prisma, pizzaId, partnerId) => {
  const stores = await prisma.store.findMany({
    where: { partnerId },
    select: { id: true },
  });

  if (!stores.length) return;

  await prisma.storePizzaStock.createMany({
    data: stores.map((store) => ({
      storeId: store.id,
      pizzaId,
      stock: 0,
      active: true,
    })),
    skipDuplicates: true,
  });
};

const ensureLegacyBases = async (prisma, { partnerId }) => {
  if (!partnerId) return;

  const existingBases = await prisma.menuPizza.findMany({
    where: { partnerId, type: "BASE" },
    select: {
      id: true,
      name: true,
      cookingMethod: true,
      selectSize: true,
      priceBySize: true,
    },
  });
  const existingByKey = new Map(
    existingBases.map((base) => [
      normalizeBaseKey(base.cookingMethod || base.name),
      base,
    ])
  );

  const sellablePizzas = await prisma.menuPizza.findMany({
    where: {
      partnerId,
      status: "ACTIVE",
      type: "SELLABLE",
    },
    select: {
      id: true,
      category: true,
      cookingMethod: true,
      selectSize: true,
      priceBySize: true,
    },
  });

  const derived = new Map();

  sellablePizzas.forEach((pizza) => {
    const baseName = getBaseNameFromPizza(pizza);
    const key = normalizeBaseKey(baseName);
    const current =
      derived.get(key) || {
        name: baseName,
        selectSize: [],
        priceBySize: {},
      };
    const prices = getPriceObject(pizza.priceBySize);

    sortSizes(pizza.selectSize ?? []).forEach((size) => {
      if (!current.selectSize.includes(size)) current.selectSize.push(size);

      const nextPrice = priceNumber(prices[size]);
      const currentPrice = priceNumber(current.priceBySize[size]);
      if (
        nextPrice != null &&
        (currentPrice == null || nextPrice < currentPrice)
      ) {
        current.priceBySize[size] = prices[size];
      } else if (current.priceBySize[size] == null) {
        current.priceBySize[size] = "";
      }
    });

    current.selectSize = sortSizes(current.selectSize);
    derived.set(key, current);
  });

  for (const [key, base] of derived.entries()) {
    if (!base.selectSize.length) continue;

    const existing = existingByKey.get(key);

    if (!existing) {
      const createdBase = await prisma.menuPizza.create({
        data: {
          name: base.name,
          partnerId,
          category: null,
          categoryId: null,
          selectSize: base.selectSize,
          priceBySize: base.priceBySize,
          cookingMethod: base.name,
          status: "ACTIVE",
          type: "BASE",
        },
      });

      await zeroStockForBase(prisma, createdBase.id, partnerId);
      continue;
    }

    const existingSizes = sortSizes(existing.selectSize ?? []);
    const nextSizes = sortSizes([...existingSizes, ...base.selectSize]);
    const nextPrices = {
      ...getPriceObject(existing.priceBySize),
    };
    let changed = nextSizes.length !== existingSizes.length;

    base.selectSize.forEach((size) => {
      if (nextPrices[size] == null || nextPrices[size] === "") {
        nextPrices[size] = base.priceBySize[size] ?? "";
        changed = true;
      }
    });

    if (changed) {
      await prisma.menuPizza.update({
        where: { id: existing.id },
        data: {
          selectSize: nextSizes,
          priceBySize: nextPrices,
          cookingMethod: normalizeBaseLabel(existing.cookingMethod || existing.name),
          status: "ACTIVE",
          type: "BASE",
        },
      });
    }

    await zeroStockForBase(prisma, existing.id, partnerId);
  }
};

export default function basesPizzasRoutes(prisma) {
  const r = express.Router();

  r.get("/", async (req, res) => {
    try {
      const partnerId = req.query.partnerId ? Number(req.query.partnerId) : null;
      const storeId = req.query.storeId ? Number(req.query.storeId) : null;

      if (storeId && partnerId) {
        const store = await prisma.store.findFirst({
          where: { id: storeId, partnerId },
          select: { id: true },
        });

        if (!store) {
          return res.status(404).json([]);
        }
      }

      if (partnerId) {
        await ensureLegacyBases(prisma, { partnerId });
      }

      const rows = await prisma.menuPizza.findMany({
        where: {
          ...(partnerId ? { partnerId } : {}),
          status: "ACTIVE",
          OR: [
            { type: "BASE" },
            {
              name: {
                startsWith: "BASE",
              },
            },
          ],
          ...(storeId
            ? {
                stocks: {
                  some: {
                    storeId,
                    active: true,
                  },
                },
              }
            : {}),
        },
        select: {
          id: true,
          name: true,
          category: true,
          categoryId: true,
          categoryRef: {
            select: {
              id: true,
              name: true,
            },
          },
          selectSize: true,
          priceBySize: true,
          image: true,
          cookingMethod: true,
        },
        orderBy: { id: "asc" },
      });

      const grouped = new Map();

      rows.forEach((row) => {
        const baseName = normalizeBaseLabel(row.cookingMethod || row.name);
        const key = normalizeBaseKey(baseName);
        const current =
          grouped.get(key) || {
            pizzaId: row.id,
            name: baseName,
            categoryId: row.categoryId ?? null,
            category: row.categoryRef?.name ?? row.category ?? null,
            selectSize: [],
            priceBySize: {},
            image: row.image ?? null,
          };
        const prices = getPriceObject(row.priceBySize);

        sortSizes(row.selectSize ?? []).forEach((size) => {
          if (!current.selectSize.includes(size)) {
            current.selectSize.push(size);
          }
          if (current.priceBySize[size] == null || current.priceBySize[size] === "") {
            current.priceBySize[size] = prices[size] ?? "";
          }
        });

        current.selectSize = sortSizes(current.selectSize);
        grouped.set(key, current);
      });

      res.json([...grouped.values()]);
    } catch (err) {
      console.error("basesPizzas error:", err);
      res.status(500).json([]);
    }
  });

  return r;
}
