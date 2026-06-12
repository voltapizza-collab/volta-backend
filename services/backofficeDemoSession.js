const DEMO_USERNAME = "prueba1";
const DEMO_PASSWORD = "prueba1";
const DEMO_PARTNER_SLUG = "volta-demo";

const compactCredential = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

export const isBackofficeDemoCredential = ({ username, password }) =>
  compactCredential(username) === DEMO_USERNAME &&
  compactCredential(password) === DEMO_PASSWORD;

const demoIngredients = [
  { name: "Mozzarella demo", category: "CHEESE", unit: "kg", stock: 42, costPrice: 4.2 },
  { name: "Pepperoni demo", category: "PROTEIN", unit: "kg", stock: 18, costPrice: 7.8 },
  { name: "Tomate San Marzano demo", category: "SAUCE", unit: "kg", stock: 35, costPrice: 3.1 },
  { name: "Champinones demo", category: "VEGETABLE", unit: "kg", stock: 12, costPrice: 2.6 },
];

const demoCategories = [
  { name: "Demo Pizzas", customizable: true, halfAndHalf: true, position: 1 },
  { name: "Demo Especiales", customizable: false, halfAndHalf: true, position: 2 },
];

const demoCustomers = [
  {
    code: "VOLTA-DEMO-CUST-001",
    name: "Laura Demo",
    phone: "+34600111001",
    email: "laura.demo@voltapizza.test",
    address_1: "Rua do Paseo 12, 32003 Ourense",
    zipCode: "32003",
    segment: "vip",
    origin: "QR",
    activity: "HOT",
  },
  {
    code: "VOLTA-DEMO-CUST-002",
    name: "Pablo Prueba",
    phone: "+34600111002",
    email: "pablo.prueba@voltapizza.test",
    address_1: "Avenida de Zamora 48, 32005 Ourense",
    zipCode: "32005",
    segment: "dormido",
    origin: "PHONE",
    activity: "COLD",
  },
  {
    code: "VOLTA-DEMO-CUST-003",
    name: "Marta Demo",
    phone: "+34600111003",
    email: "marta.demo@voltapizza.test",
    address_1: "Praza Maior 1, 32005 Ourense",
    zipCode: "32005",
    segment: "nuevo",
    origin: "QR",
    activity: "HOT",
  },
];

const daysAgo = (days, hour = 13, minute = 20) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date;
};

const findOrCreateCategory = async (tx, data) => {
  const existing = await tx.category.findUnique({ where: { name: data.name } });
  if (existing) {
    return tx.category.update({ where: { id: existing.id }, data });
  }
  return tx.category.create({ data });
};

const findOrCreateIngredient = async (tx, data) => {
  const existing = await tx.ingredient.findFirst({ where: { name: data.name } });
  if (existing) {
    return tx.ingredient.update({ where: { id: existing.id }, data });
  }
  return tx.ingredient.create({
    data: {
      ...data,
      allergens: [],
      isSystem: false,
      status: "ACTIVE",
    },
  });
};

const upsertMenuPizza = async (tx, { partnerId, categoryId, data }) => {
  const existing = await tx.menuPizza.findFirst({
    where: { partnerId, name: data.name },
    select: { id: true },
  });

  const payload = {
    ...data,
    partnerId,
    categoryId,
    category: data.category,
    selectSize: ["M", "L", "XL"],
    priceBySize: { M: data.basePrice, L: data.basePrice + 3, XL: data.basePrice + 6 },
    status: "ACTIVE",
    type: "SELLABLE",
  };
  delete payload.basePrice;

  if (existing) {
    return tx.menuPizza.update({ where: { id: existing.id }, data: payload });
  }
  return tx.menuPizza.create({ data: payload });
};

const buildDemoSession = (partner, store) => ({
  partnerId: partner.id,
  storeId: store?.id,
  partnerName: partner.name,
  partnerSlug: partner.slug,
  isDemo: true,
});

export async function ensureBackofficeDemoSession(prisma) {
  const existingPartner = await prisma.partner.findUnique({
    where: { slug: DEMO_PARTNER_SLUG },
  });

  if (existingPartner) {
    const existingStore = await prisma.store.findFirst({
      where: { partnerId: existingPartner.id, slug: "demo-central" },
    });

    if (existingStore) {
      return buildDemoSession(existingPartner, existingStore);
    }
  }

  return prisma.$transaction(async (tx) => {
    const partner = await tx.partner.upsert({
      where: { slug: DEMO_PARTNER_SLUG },
      update: {
        name: "Volta Pizza Demo",
        country: "ES",
        currency: "EUR",
        active: true,
        deliveryRadiusKm: 8,
        deliveryPricingMode: "VARIABLE",
        deliveryFeeBlockSize: 5,
        deliveryMaxPizzasPerOrder: 8,
        deliveryFeeFixed: 2.5,
        deliveryFeeBase: 2.5,
        deliveryBaseKm: 2,
        deliveryExtraPerKm: 0.7,
        brandPrimary: "#111827",
        brandSecondary: "#F43F5E",
        brandAccent: "#FBBF24",
        brandSurface: "#FFFFFF",
        brandTextColor: "#111827",
        brandFontFamily: "Inter",
        brandOfferButtonStyle: "solid",
        minimumPaymentAmount: 12,
      },
      create: {
        name: "Volta Pizza Demo",
        slug: DEMO_PARTNER_SLUG,
        country: "ES",
        currency: "EUR",
        active: true,
        deliveryRadiusKm: 8,
        deliveryPricingMode: "VARIABLE",
        deliveryFeeBlockSize: 5,
        deliveryMaxPizzasPerOrder: 8,
        deliveryFeeFixed: 2.5,
        deliveryFeeBase: 2.5,
        deliveryBaseKm: 2,
        deliveryExtraPerKm: 0.7,
        brandPrimary: "#111827",
        brandSecondary: "#F43F5E",
        brandAccent: "#FBBF24",
        brandSurface: "#FFFFFF",
        brandTextColor: "#111827",
        brandFontFamily: "Inter",
        brandOfferButtonStyle: "solid",
        minimumPaymentAmount: 12,
      },
    });

    const existingStore = await tx.store.findFirst({
      where: { partnerId: partner.id, slug: "demo-central" },
      select: { id: true },
    });

    const storePayload = {
      partnerId: partner.id,
      slug: "demo-central",
      storeName: "Demo Central",
      tlf: "+34600111999",
      address: "Rua do Paseo 12, 32003 Ourense",
      latitude: 42.3362,
      longitude: -7.8639,
      city: "Ourense",
      zipCode: "32003",
      email: "demo@voltapizza.test",
      active: true,
      acceptingOrders: true,
      acceptsReservations: true,
      reservationCapacity: 24,
    };

    const store = existingStore
      ? await tx.store.update({ where: { id: existingStore.id }, data: storePayload })
      : await tx.store.create({ data: storePayload });

    return buildDemoSession(partner, store);

    const categories = [];
    for (const categoryData of demoCategories) {
      const category = await findOrCreateCategory(tx, categoryData);
      categories.push(category);
      await tx.partnerCategory.upsert({
        where: {
          partnerId_categoryId: {
            partnerId: partner.id,
            categoryId: category.id,
          },
        },
        update: {
          enabled: true,
          position: categoryData.position,
        },
        create: {
          partnerId: partner.id,
          categoryId: category.id,
          enabled: true,
          position: categoryData.position,
        },
      });
    }

    const ingredients = [];
    for (const ingredientData of demoIngredients) {
      const ingredient = await findOrCreateIngredient(tx, ingredientData);
      ingredients.push(ingredient);
      await tx.storeIngredientStock.upsert({
        where: {
          storeId_ingredientId: {
            storeId: store.id,
            ingredientId: ingredient.id,
          },
        },
        update: {
          stock: ingredientData.stock,
          active: true,
        },
        create: {
          storeId: store.id,
          ingredientId: ingredient.id,
          stock: ingredientData.stock,
          active: true,
        },
      });
    }

    const pizzaCategory = categories[0];
    const pizzas = [];
    for (const pizzaData of [
      {
        name: "Demo Pepperoni Boost",
        category: pizzaCategory.name,
        cookingMethod: "Horno de piedra",
        basePrice: 13.9,
      },
      {
        name: "Demo Veggie Crush",
        category: pizzaCategory.name,
        cookingMethod: "Horno de piedra",
        basePrice: 12.5,
      },
    ]) {
      const pizza = await upsertMenuPizza(tx, {
        partnerId: partner.id,
        categoryId: pizzaCategory.id,
        data: pizzaData,
      });
      pizzas.push(pizza);
      await tx.storePizzaStock.upsert({
        where: {
          storeId_pizzaId: {
            storeId: store.id,
            pizzaId: pizza.id,
          },
        },
        update: {
          stock: 25,
          active: true,
        },
        create: {
          storeId: store.id,
          pizzaId: pizza.id,
          stock: 25,
          active: true,
        },
      });
    }

    for (const customerData of demoCustomers) {
      await tx.customer.upsert({
        where: { code: customerData.code },
        update: {
          ...customerData,
          partnerId: partner.id,
          portal: "Backoffice demo",
          observations: "Cliente de prueba para explorar el back office.",
          segmentUpdatedAt: new Date(),
        },
        create: {
          ...customerData,
          partnerId: partner.id,
          portal: "Backoffice demo",
          observations: "Cliente de prueba para explorar el back office.",
          segmentUpdatedAt: new Date(),
        },
      });
    }

    const customers = await tx.customer.findMany({
      where: { partnerId: partner.id, code: { in: demoCustomers.map((customer) => customer.code) } },
      orderBy: { code: "asc" },
    });

    const sales = [
      {
        code: "VOLTA-DEMO-ORDER-001",
        date: daysAgo(0, 12, 35),
        customer: customers[0],
        pizza: pizzas[0],
        total: 21.8,
        status: "PENDING",
        processed: false,
        delivery: "COURIER",
        channel: "WEB",
        boostActive: true,
      },
      {
        code: "VOLTA-DEMO-ORDER-002",
        date: daysAgo(1, 20, 10),
        customer: customers[1],
        pizza: pizzas[1],
        total: 16.5,
        status: "PAID",
        processed: true,
        delivery: "PICKUP",
        channel: "PHONE",
        boostActive: false,
      },
      {
        code: "VOLTA-DEMO-ORDER-003",
        date: daysAgo(3, 14, 5),
        customer: customers[2],
        pizza: pizzas[0],
        total: 29.7,
        status: "PAID",
        processed: true,
        delivery: "COURIER",
        channel: "WHATSAPP",
        boostActive: false,
      },
    ];

    for (const sale of sales) {
      await tx.sale.upsert({
        where: { code: sale.code },
        update: {
          date: sale.date,
          partnerId: partner.id,
          storeId: store.id,
          customerId: sale.customer?.id,
          type: sale.delivery === "PICKUP" ? "pickup" : "delivery",
          delivery: sale.delivery,
          customerData: {
            name: sale.customer?.name,
            phone: sale.customer?.phone,
            address_1: sale.customer?.address_1,
            zipCode: sale.customer?.zipCode,
          },
          products: [
            {
              pizzaId: sale.pizza.id,
              name: sale.pizza.name,
              size: "L",
              quantity: sale.code.endsWith("003") ? 2 : 1,
              price: sale.total,
            },
          ],
          extras: [],
          totalProducts: sale.total,
          discounts: sale.code.endsWith("002") ? 2 : 0,
          total: sale.total,
          processed: sale.processed,
          notes: "Pedido demo para explorar controles del back office.",
          status: sale.status,
          channel: sale.channel,
          currency: partner.currency,
          address_1: sale.customer?.address_1,
          boostActive: sale.boostActive,
          boostTargetPosition: sale.boostActive ? 1 : null,
          boostOriginalPosition: sale.boostActive ? 4 : null,
          boostQueueCredit: sale.boostActive ? 3 : 0,
          boostAmount: sale.boostActive ? 1.5 : null,
          boostPaidAt: sale.boostActive ? sale.date : null,
          boostMeta: sale.boostActive ? { source: "demo_session" } : null,
        },
        create: {
          code: sale.code,
          date: sale.date,
          partnerId: partner.id,
          storeId: store.id,
          customerId: sale.customer?.id,
          type: sale.delivery === "PICKUP" ? "pickup" : "delivery",
          delivery: sale.delivery,
          customerData: {
            name: sale.customer?.name,
            phone: sale.customer?.phone,
            address_1: sale.customer?.address_1,
            zipCode: sale.customer?.zipCode,
          },
          products: [
            {
              pizzaId: sale.pizza.id,
              name: sale.pizza.name,
              size: "L",
              quantity: sale.code.endsWith("003") ? 2 : 1,
              price: sale.total,
            },
          ],
          extras: [],
          totalProducts: sale.total,
          discounts: sale.code.endsWith("002") ? 2 : 0,
          total: sale.total,
          processed: sale.processed,
          notes: "Pedido demo para explorar controles del back office.",
          status: sale.status,
          channel: sale.channel,
          currency: partner.currency,
          address_1: sale.customer?.address_1,
          boostActive: sale.boostActive,
          boostTargetPosition: sale.boostActive ? 1 : null,
          boostOriginalPosition: sale.boostActive ? 4 : null,
          boostQueueCredit: sale.boostActive ? 3 : 0,
          boostAmount: sale.boostActive ? 1.5 : null,
          boostPaidAt: sale.boostActive ? sale.date : null,
          boostMeta: sale.boostActive ? { source: "demo_session" } : null,
        },
      });
    }

    for (const coupon of [
      {
        code: "VOLTADEMO10",
        kind: "PERCENT",
        variant: "FIXED",
        percent: 10,
        campaign: "Bienvenida demo",
      },
      {
        code: "VOLTADEMO5EUR",
        kind: "AMOUNT",
        variant: "FIXED",
        amount: 5,
        minAmount: 20,
        campaign: "Recuperacion demo",
      },
    ]) {
      await tx.coupon.upsert({
        where: { code: coupon.code },
        update: {
          ...coupon,
          partnerId: partner.id,
          acquisition: "CLAIM",
          channel: "CRM",
          visibility: "PUBLIC",
          usageLimit: 50,
          status: "ACTIVE",
          activeFrom: daysAgo(7),
          expiresAt: daysAgo(-21),
          daysActive: [1, 2, 3, 4, 5, 6, 0],
        },
        create: {
          ...coupon,
          partnerId: partner.id,
          acquisition: "CLAIM",
          channel: "CRM",
          visibility: "PUBLIC",
          usageLimit: 50,
          status: "ACTIVE",
          activeFrom: daysAgo(7),
          expiresAt: daysAgo(-21),
          daysActive: [1, 2, 3, 4, 5, 6, 0],
        },
      });
    }

    const promoPayload = {
      partnerId: partner.id,
      title: "Combo Demo Familiar",
      description: "2 pizzas L + bebida para mostrar promos.",
      items: [{ name: "2 pizzas L", quantity: 1 }, { name: "Bebida", quantity: 1 }],
      totalPrice: 29.9,
      status: "ACTIVE",
      activeFrom: daysAgo(2),
      expiresAt: daysAgo(-14),
    };
    const existingPromo = await tx.promo.findFirst({
      where: { partnerId: partner.id, title: promoPayload.title },
      select: { id: true },
    });
    if (existingPromo) {
      await tx.promo.update({ where: { id: existingPromo.id }, data: promoPayload });
    } else {
      await tx.promo.create({ data: promoPayload });
    }

    const directDiscountPayload = {
      partnerId: partner.id,
      title: "Top Deal Demo 15%",
      discountType: "PERCENT",
      value: 15,
      targetType: "CATEGORY",
      categoryIds: [pizzaCategory.id],
      categoryNames: [pizzaCategory.name],
      storeIds: [store.id],
      status: "ACTIVE",
      activeFrom: daysAgo(1),
      expiresAt: daysAgo(-10),
    };
    const existingDirectDiscount = await tx.directDiscount.findFirst({
      where: { partnerId: partner.id, title: directDiscountPayload.title },
      select: { id: true },
    });
    if (existingDirectDiscount) {
      await tx.directDiscount.update({
        where: { id: existingDirectDiscount.id },
        data: directDiscountPayload,
      });
    } else {
      await tx.directDiscount.create({ data: directDiscountPayload });
    }

    await tx.game.upsert({
      where: {
        partnerId_slug: {
          partnerId: partner.id,
          slug: "demo-winning-number",
        },
      },
      update: {
        name: "Demo Winning Number",
        description: "Juego demo conectado a cupones.",
        active: true,
        storeId: store.id,
      },
      create: {
        partnerId: partner.id,
        storeId: store.id,
        name: "Demo Winning Number",
        slug: "demo-winning-number",
        description: "Juego demo conectado a cupones.",
        active: true,
      },
    });

    return {
      partnerId: partner.id,
      storeId: store.id,
      partnerName: partner.name,
      partnerSlug: partner.slug,
      isDemo: true,
    };
  }, { timeout: 30000 });
}
