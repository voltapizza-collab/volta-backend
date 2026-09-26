// Exact historical record reviewed against its existing translations. Never
// redirect identities or merge ingredients as part of a display-name repair.
export const ingredientNameRepairs = Object.freeze([
  { id:135, canonicalKey:'r_cula', from:'R\uFFFDcula', to:'Rúcula', category:'VERDURAS',
    evidence:{en:'Arugula',it:'Rucola',fr:'Roquette',pt:'Rúcula'} },
]);

export async function applyReviewedIngredientNameRepairs(tx) {
  for (const repair of ingredientNameRepairs) {
    const row=await tx.ingredient.findUnique({where:{id:repair.id},include:{translations:true}});
    if(!row || row.canonicalKey!==repair.canonicalKey || row.category!==repair.category || !row.isSystem)
      throw new Error(`Name repair identity mismatch: ${repair.id}`);
    if(row.name===repair.to) continue;
    if(row.name!==repair.from) throw new Error(`Name repair stale value: ${repair.id}`);
    for(const [locale,name] of Object.entries(repair.evidence))
      if(!row.translations.some(t=>t.locale===locale && t.name===name)) throw new Error(`Name repair evidence mismatch: ${repair.id}/${locale}`);
    const count=await tx.$executeRawUnsafe('UPDATE Ingredient SET name = ? WHERE id = ? AND BINARY name = ? AND canonicalKey = ?',repair.to,repair.id,repair.from,repair.canonicalKey);
    if(count!==1)throw new Error(`Name repair concurrent edit: ${repair.id}`);
  }
}
