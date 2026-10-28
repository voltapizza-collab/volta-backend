import { sendIngredientDisabledTrackingSms } from './trackingNotifications.js';
import { sendOrderReadySms } from './orderNotifications.js';
import { createProductReviewRequestForSale } from './productReviews.js';

export function posOutboxHandlers(prisma) {
  const sale = id => prisma.sale.findUnique({ where: { id }, include: { partner: true, store: true, customer: true } });
  return {
    async INGREDIENT_DISABLED({ storeId, ingredientId, occurredAt }) {
      const [store, ingredient] = await Promise.all([
        prisma.store.findUnique({ where: { id: storeId }, include: { partner: true } }),
        prisma.ingredient.findUnique({ where: { id: ingredientId } }),
      ]);
      return sendIngredientDisabledTrackingSms(prisma, { store, ingredient, stock: { storeId, ingredientId, updatedAt: occurredAt } });
    },
    async ORDER_READY({ saleId }) {
      const order = await sale(saleId);
      if (!order || !order.processed || order.status !== 'PAID') return { skipped: true };
      return sendOrderReadySms(prisma, order);
    },
    async ORDER_REVIEW({ saleId }) {
      const order = await sale(saleId);
      if (!order || !order.processed || order.status !== 'PAID') return { skipped: true };
      return createProductReviewRequestForSale(prisma, order);
    },
  };
}
