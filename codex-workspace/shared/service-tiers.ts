/** Explicit requests supported by the site's tier controls, for every model. */
export const SERVICE_TIERS = [
  { id: 'auto', name: 'Auto' },
  { id: 'default', name: 'Standard' },
  { id: 'flex', name: 'Flex' },
  { id: 'scale', name: 'Scale' },
  { id: 'priority', name: 'Priority' },
  { id: 'fast', name: 'Fast' },
  { id: 'ultrafast', name: 'Ultrafast' },
] as const;

export const requestedServiceTier = (value: unknown): boolean => SERVICE_TIERS.some(tier => tier.id === value);
export const validServiceTier = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= 100 && value === value.trim() && !/[\u0000-\u001f\u007f-\u009f]/.test(value);

export function validComposerTiers(value: unknown): value is Record<string, string> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= 1000
    && Object.entries(value).every(([key, tier]) => (key === 'draft' || /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(key)) && validServiceTier(tier));
}
