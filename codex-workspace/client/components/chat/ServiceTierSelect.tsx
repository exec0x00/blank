import { SelectMenu } from '../ui/Dropdown';
import { SERVICE_TIERS } from '../../../shared/service-tiers';

export default function ServiceTierSelect({ value, disabled, onValueChange }: {
  value: string; disabled?: boolean; onValueChange(value: string): void;
}) {
  const options: Array<{ value: string; label: string; description?: string }> = SERVICE_TIERS.map(tier => ({
    value: tier.id, label: tier.name,
    ...(['priority', 'fast'].includes(tier.id) ? { description: 'Requests Fast mode' } : {}),
  }));
  if (!options.some(option => option.value === value)) options.push({ value, label: value });
  return <SelectMenu value={value} onValueChange={onValueChange} options={options}
    aria-label="Service tier" className="chat-service-tier-select" compact disabled={disabled} />;
}
