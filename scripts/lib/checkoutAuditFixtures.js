import assert from 'node:assert/strict';

// Call only after validateSandboxUrl. These temporary records are removed by the
// caller before comparing all table digests. They never represent real sales.
export async function checkoutAuditFixtures(prisma, partner, store, publicMenu, cleanup) {
  const menu=publicMenu.menu;
  const pizza=menu.find(p=>p.categoryHalfAndHalf&&p.categoryCustomizable&&p.ingredients.length&&p.selectSize.includes('M')&&!p.directDiscount);
  assert.ok(pizza,'Need a customizable half-and-half dish');
  const other=menu.find(p=>p.pizzaId!==pizza.pizzaId&&p.categoryHalfAndHalf&&p.selectSize.includes('M')&&!p.ingredients.some(i=>i.id===pizza.ingredients[0].id)&&!p.directDiscount);
  assert.ok(other,'Need an independent half-and-half dish');
  const size='M';
  const normal=p=>({cartLineId:`audit-${p.pizzaId}`,pizzaId:p.pizzaId,name:'Audit dish',type:'SELLABLE',source:'menu',categoryId:p.categoryId,category:p.category,size,qty:1,price:Number(p.priceBySize[size]),subtotal:Number(p.priceBySize[size])});
  const standard=normal(pizza), independent=normal(other);
  const ingredientId=pizza.ingredients[0].id;
  let extra=await prisma.ingredientExtra.findUnique({where:{partnerId_ingredientId_categoryId:{partnerId:partner.id,ingredientId,categoryId:other.categoryId}}});
  if(extra) {
    const original={...extra};
    cleanup.push(()=>prisma.$executeRawUnsafe('UPDATE IngredientExtra SET status = ?, updatedAt = ? WHERE id = ?',original.status,original.updatedAt,original.id));
    if(extra.status!=='ACTIVE')extra=await prisma.ingredientExtra.update({where:{id:extra.id},data:{status:'ACTIVE'}});
  } else {
    extra=await prisma.ingredientExtra.create({data:{partnerId:partner.id,ingredientId,categoryId:other.categoryId,price:1,status:'ACTIVE'}});
    cleanup.push(()=>prisma.ingredientExtra.delete({where:{id:extra.id}}));
  }
  const extraPrice=Number(extra.priceBySize?.M)>0?Number(extra.priceBySize.M):Number(extra.price);
  const ingredient=await prisma.ingredient.findUnique({where:{id:ingredientId}});
  const profile=await prisma.partnerIngredientProfile.findUnique({where:{partnerId_ingredientId:{partnerId:partner.id,ingredientId}}});
  const selected={ingredientId,name:ingredient.name,quantity:'SIMPLE',placement:'FULL',price:Math.round(Number(profile?.costPrice??ingredient.costPrice??0)*100)/100};
  const categoryPrices=menu.filter(p=>p.categoryId===pizza.categoryId&&p.selectSize.includes(size)).map(p=>Number(p.priceBySize[size]));
  const base=Math.round(Math.min(...categoryPrices)*0.8*100)/100;
  const promo=await prisma.promo.create({data:{partnerId:partner.id,title:'Isolated audit promo',totalPrice:8,items:[{pizzaId:pizza.pizzaId,size,quantity:1}],status:'ACTIVE'}});
  cleanup.push(()=>prisma.promo.delete({where:{id:promo.id}}));
  const incentive=await prisma.incentive.create({data:{partnerId:partner.id,name:'Isolated audit reward',rewardPizzaId:pizza.pizzaId,triggerMode:'FIXED',fixedAmount:1,active:true}});
  cleanup.push(()=>prisma.incentive.delete({where:{id:incentive.id}}));
  const halfPrice=Math.max(standard.price,independent.price);
  const cases=[
    ['recipe',[standard]],
    ['extra',[{...independent,extras:[{ingredientId,price:extraPrice}],subtotal:independent.price+extraPrice}]],
    ['custom',[{...standard,cartLineId:'custom-audit',type:'CUSTOM_BUILD',source:'custom',price:base,subtotal:Math.round((base+selected.price)*100)/100,ingredients:[selected],customDetails:{ingredients:[selected]}}]],
    ['half',[{...standard,type:'HALF_HALF',leftPizzaId:pizza.pizzaId,rightPizzaId:other.pizzaId,price:halfPrice,subtotal:halfPrice}]],
    ['promo',[{cartLineId:'promo-audit',type:'PROMO',source:'promo',promoId:promo.id,name:promo.title,qty:1,price:8,subtotal:8,promoItems:[{pizzaId:pizza.pizzaId,size,quantity:1}]}]],
    ['reward',[independent,{...standard,cartLineId:'reward-audit',type:'INCENTIVE_REWARD',source:'incentive_reward',incentiveId:incentive.id,rewardPizzaId:pizza.pizzaId,price:-standard.price,subtotal:0}]],
  ];
  const independentIngredientId=pizza.ingredients.find(i=>i.id!==ingredientId)?.id;
  assert.ok(independentIngredientId);
  const independentIngredient=await prisma.ingredient.findUnique({where:{id:independentIngredientId}});
  const independentProfile=await prisma.partnerIngredientProfile.findUnique({where:{partnerId_ingredientId:{partnerId:partner.id,ingredientId:independentIngredientId}}});
  const independentSelection={...selected,ingredientId:independentIngredientId,name:independentIngredient.name,price:Math.round(Number(independentProfile?.costPrice??independentIngredient.costPrice??0)*100)/100};
  cases.push(['custom_independent',[{...cases.find(([kind])=>kind==='custom')[1][0],ingredients:[independentSelection],customDetails:{ingredients:[independentSelection]},subtotal:Math.round((base+independentSelection.price)*100)/100}]]);
  return {cases,standard,independent,pizza,ingredientId,promo,incentive};
}
