import axios from "axios";

export const GOOGLE_GEOCODING_URL =
  "https://maps.googleapis.com/maps/api/geocode/json";
export const GOOGLE_ROUTE_MATRIX_URL =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
export const COVERAGE_ROUTE_ESTIMATE_FACTOR = Number(
  process.env.COVERAGE_ROUTE_ESTIMATE_FACTOR || 1.3
);

export const getGoogleGeocodingKey = () =>
  process.env.GOOGLE_GEOCODING_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.REACT_APP_GOOGLE_KEY ||
  "";


export async function geocodeAddress(address, region, key) {
  const response = await axios.get(GOOGLE_GEOCODING_URL, {
    timeout: 8000,
    params: {
      address,
      region,
      key,
    },
  });

  const result = response.data?.results?.[0];

  if (!result?.geometry?.location) {
    return null;
  }

  return {
    formattedAddress: result.formatted_address,
    lat: Number(result.geometry.location.lat),
    lng: Number(result.geometry.location.lng),
    locationType: result.geometry.location_type,
    partialMatch: Boolean(result.partial_match),
    types: Array.isArray(result.types) ? result.types : [],
  };
}

export async function geocodeCustomerAddress(address, partner, stores, key) {
  const directMatch = await geocodeAddress(address, partner.country || "ES", key);
  if (directMatch) return directMatch;

  const fallbackCity = stores.find((store) => store?.city)?.city;
  const enrichedAddress = [address, fallbackCity, partner.country]
    .filter(Boolean)
    .join(", ");

  if (enrichedAddress !== address) {
    return geocodeAddress(enrichedAddress, partner.country || "ES", key);
  }

  return null;
}

export async function computeDrivingDistances(origin, stores, key) {
  if (!key || !validCoordinates(origin?.lat, origin?.lng) || !stores.length) return null;

  try {
    const response = await axios.post(
      GOOGLE_ROUTE_MATRIX_URL,
      {
        origins: [
          {
            waypoint: {
              location: {
                latLng: {
                  latitude: origin.lat,
                  longitude: origin.lng,
                },
              },
            },
          },
        ],
        destinations: stores.map((store) => ({
          waypoint: {
            location: {
              latLng: {
                latitude: store.latitude,
                longitude: store.longitude,
              },
            },
          },
        })),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
      },
      {
        timeout: 8000,
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask":
            "originIndex,destinationIndex,duration,distanceMeters,status,condition",
        },
      }
    );

    const rows = Array.isArray(response.data) ? response.data : [];
    const distancesByIndex = new Map();

    rows.forEach((row) => {
      const destinationIndex = Number(row?.destinationIndex);
      const distanceMeters = Number(row?.distanceMeters);
      const isRoutable = row?.condition === "ROUTE_EXISTS" &&
        (row?.status?.code == null || row.status.code === 0);

      if (
        Number.isInteger(destinationIndex) &&
        destinationIndex >= 0 && destinationIndex < stores.length &&
        row?.distanceMeters != null &&
        Number.isFinite(distanceMeters) &&
        distanceMeters >= 0 &&
        isRoutable
      ) {
        distancesByIndex.set(destinationIndex, {
          distanceKm: distanceMeters / 1000,
          duration: row?.duration || null,
        });
      }
    });

    if (!distancesByIndex.size) return null;

    return stores
      .map((store, index) => {
        const match = distancesByIndex.get(index);
        if (!match) return null;
        return {
          ...store,
          distanciaKm: match.distanceKm,
          routeDuration: match.duration,
          distanceSource: "DRIVING_ROUTE",
        };
      })
      .filter(Boolean);
  } catch (error) {
    console.warn("GOOGLE ROUTE MATRIX ERROR:", error?.response?.status || error?.code || "unavailable");
    return null;
  }
}

export function validCoordinates(lat, lng) {
  return lat != null && lng != null && lat !== '' && lng !== '' &&
    Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) &&
    Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180;
}


export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
}

export function isPreciseCustomerGeocode(geocode) {
  if (!geocode) return false;
  if (geocode.source === "PLACE_AUTOCOMPLETE") return true;

  const preciseTypes = new Set([
    "street_address",
    "premise",
    "subpremise",
    "establishment",
    "point_of_interest",
  ]);

  return (
    geocode.partialMatch !== true &&
    (geocode.types || []).some((type) => preciseTypes.has(type))
  );
}

