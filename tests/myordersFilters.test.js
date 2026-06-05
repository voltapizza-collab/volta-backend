import assert from "node:assert/strict";
import { test } from "node:test";
import { completedOrderWhere } from "../routes/myorders.js";

test("completed daily orders require confirmed payment and processed order", () => {
  assert.deepEqual(completedOrderWhere({ partnerId: 1, storeId: 2, activeStoresOnly: false }), {
    partnerId: 1,
    storeId: 2,
    processed: true,
    status: "PAID",
  });
});
