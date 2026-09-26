import {
  getGoogleGeocodingKey, geocodeCustomerAddress, computeDrivingDistances,
  isPreciseCustomerGeocode, validCoordinates,
} from './deliveryGeography.js';

const money = value => Math.round(Number(value) * 100) / 100;
const nonNegative = value => Number.isFinite(Number(value)) && Number(value) >= 0;
const unresolved = reason => ({ resolved:false, reason });

// Pure tariff calculation. Its distance argument must come from the server's
// resolver, never from a request body or a saved browser selection.
export function calculateDeliveryFee(partner, distanceKm) {
  if (partner.deliveryPricingMode !== 'VARIABLE') {
    if(!nonNegative(partner.deliveryFeeFixed ?? 0)) throw new Error('invalid_delivery_policy');
    return money(partner.deliveryFeeFixed || 0);
  }
  const base=partner.deliveryFeeBase ?? 0, includedKm=partner.deliveryBaseKm ?? 0, perKm=partner.deliveryExtraPerKm ?? 0;
  if(distanceKm == null || !nonNegative(distanceKm) || ![base,includedKm,perKm].every(nonNegative))
    throw new Error('invalid_delivery_policy');
  return money(Number(base) + Math.ceil(Math.max(0,Number(distanceKm)-Number(includedKm))) * Number(perKm));
}

// Resolves facts only. The policy for an unresolved route is handled separately.
// Dependencies are injectable so tests never contact mapping or payment services.
export async function resolveCheckoutDelivery(partner, store, delivery, dependencies = {}) {
  if(delivery.method !== 'COURIER') return { resolved:true, deliveryFee:0, distanceKm:null, source:'PICKUP', coords:null };
  if(partner.deliveryPricingMode !== 'VARIABLE')
    return { resolved:true, deliveryFee:calculateDeliveryFee(partner,0), distanceKm:null, source:'FIXED', coords:null };
  const address=String(delivery.address || '').trim();
  if(!address) return unresolved('ADDRESS_REQUIRED');
  if(!validCoordinates(store.latitude,store.longitude)) return unresolved('STORE_COORDINATES_UNAVAILABLE');
  const key=(dependencies.getKey || getGoogleGeocodingKey)();
  if(!key) return unresolved('GEOCODING_NOT_CONFIGURED');
  const geocode=dependencies.geocode || geocodeCustomerAddress;
  const route=dependencies.route || computeDrivingDistances;
  try {
    // Re-geocode the actual delivery address. Browser coords and distance are
    // ignored, including when they were originally returned by the public API.
    const location=await geocode(address,partner,[store],key);
    if(!location || !validCoordinates(location.lat,location.lng) || !isPreciseCustomerGeocode(location))
      return unresolved('ADDRESS_NOT_VERIFIED');
    const routes=await route({lat:Number(location.lat),lng:Number(location.lng)},[store],key);
    const matched=routes?.find(row=>Number(row.id)===Number(store.id));
    if(!matched || matched.distanciaKm == null || !nonNegative(matched.distanciaKm)) return unresolved('ROUTE_UNAVAILABLE');
    const distanceKm=Number(matched.distanciaKm);
    const radius=partner.deliveryRadiusKm == null ? null : Number(partner.deliveryRadiusKm);
    if(radius != null && (!Number.isFinite(radius) || radius < 0)) return unresolved('INVALID_DELIVERY_POLICY');
    if(radius != null && distanceKm > radius) return {resolved:false,reason:'OUTSIDE_DELIVERY_AREA'};
    return {resolved:true,deliveryFee:calculateDeliveryFee(partner,distanceKm),distanceKm,
      source:'DRIVING_ROUTE',coords:{lat:Number(location.lat),lng:Number(location.lng)},formattedAddress:location.formattedAddress};
  } catch {
    return unresolved('DELIVERY_PROVIDER_UNAVAILABLE');
  }
}

const reject = (error, details = {}) => { throw Object.assign(new Error(error), { status:409, details }); };

export async function validateCheckoutDelivery(partner, store, delivery, dependencies = {}) {
  let quote=await resolveCheckoutDelivery(partner,store,delivery,dependencies);
  if(!quote.resolved) {
    if(quote.reason==='ADDRESS_REQUIRED') reject('delivery_address_required');
    if(quote.reason==='OUTSIDE_DELIVERY_AREA') reject('delivery_outside_area');
    if(quote.reason==='INVALID_DELIVERY_POLICY') reject('delivery_unavailable');
    // Preserve the application's existing manual fallback policy. The server
    // supplies the base fee, and both customer and operator must see the review.
    quote={resolved:true,deliveryFee:calculateDeliveryFee(partner,0),distanceKm:null,coords:null,
      source:'MANUAL_FALLBACK',manualReviewRequired:true,reason:quote.reason};
  }
  if(delivery.method==='COURIER' &&
    (delivery.deliveryFee == null || !nonNegative(delivery.deliveryFee) || Math.abs(money(delivery.deliveryFee)-quote.deliveryFee)>0.004 ||
    (quote.manualReviewRequired && delivery.manualReviewAccepted!==true)))
    reject('delivery_price_changed',{deliveryQuote:quote});
  return quote;
}

export function deliveryPolicyFingerprint(partner,store) {
  return JSON.stringify([
    partner.country || 'ES',partner.deliveryPricingMode || 'FIXED',
    Number(partner.deliveryFeeFixed || 0),Number(partner.deliveryFeeBase || 0),
    Number(partner.deliveryBaseKm || 0),Number(partner.deliveryExtraPerKm || 0),
    partner.deliveryRadiusKm == null ? null : Number(partner.deliveryRadiusKm),
    store.latitude == null ? null : Number(store.latitude),store.longitude == null ? null : Number(store.longitude),
  ]);
}
