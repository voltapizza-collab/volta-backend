export const DEFAULT_CUSTOMER_SEGMENT = "potencial";
export const VIP_CUSTOMER_SEGMENT = "vip";

export const CUSTOMER_SEGMENTS = [
  DEFAULT_CUSTOMER_SEGMENT,
  "nuevo",
  "dormido",
  "activo",
  VIP_CUSTOMER_SEGMENT,
];

const SEGMENT_ALIASES = {
  potencial: DEFAULT_CUSTOMER_SEGMENT,
  potential: DEFAULT_CUSTOMER_SEGMENT,
  nuevo: "nuevo",
  new: "nuevo",
  dormido: "dormido",
  sleeping: "dormido",
  activo: "activo",
  active: "activo",
  vip: VIP_CUSTOMER_SEGMENT,
};

CUSTOMER_SEGMENTS.forEach((segment, index) => {
  SEGMENT_ALIASES[`s${index + 1}`] = segment;
});

const normalizeKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export const normalizeCustomerSegment = (value, fallback = null) =>
  SEGMENT_ALIASES[normalizeKey(value)] || fallback;

export const isCustomerSegment = (value) =>
  CUSTOMER_SEGMENTS.includes(normalizeCustomerSegment(value));

export const createCustomerSegmentCounts = () =>
  Object.fromEntries(CUSTOMER_SEGMENTS.map((segment) => [segment, 0]));
