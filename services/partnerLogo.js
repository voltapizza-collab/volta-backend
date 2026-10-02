export async function replacePartnerLogo({ partner, upload, save, remove, onCleanupError }) {
  const nextLogo = await upload();
  // Keep the current logo available until its replacement is stored successfully.
  try {
    await save(nextLogo);
  } catch (error) {
    for (const id of nextLogo.createdAssetIds || []) await remove(id).catch(onCleanupError);
    throw error;
  }
  // Preserve originals (including legacy logos); only retire a previous prepared copy.
  if (partner.brandLogoOriginalPublicId && partner.brandLogoPublicId &&
      partner.brandLogoPublicId !== partner.brandLogoOriginalPublicId &&
      partner.brandLogoPublicId !== nextLogo.publicId && partner.brandLogoPublicId !== nextLogo.originalPublicId) {
    try {
      await remove(partner.brandLogoPublicId);
    } catch (error) {
      onCleanupError(error);
    }
  }
  return nextLogo;
}
