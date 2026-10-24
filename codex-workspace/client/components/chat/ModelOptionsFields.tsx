import { useId } from 'react';
import { SelectMenu } from '../ui/Dropdown';
import { modelOptionValue, OMIT_MODEL_OPTION, parseModelOption, REASONING_SUMMARIES, type ModelOption, type ModelRunPreferences, type NativeReasoningSummary } from './models';
import './model-options.css';

interface Props { profile?: ModelOption; value: ModelRunPreferences; onChange: (value: ModelRunPreferences) => void; disabled?: boolean }
export default function ModelOptionsFields({ profile, value, onChange, disabled }: Props) {
  const id = useId();
  if (profile?.kind === 'native' && profile.provider === 'bridge') return null;
  return <div className="model-options-fields">{profile?.kind === 'literal' && <div>
    <p className="field-help">Model metadata unavailable. Service acceptance is unverified.</p>
    {value.reasoningEffort !== null && <p className="field-help">Selected effort: <code>{value.reasoningEffort}</code> (literal).</p>}
  </div>}<div><label className="field-label" htmlFor={`${id}-summary`}>Public reasoning summary</label>
    <SelectMenu id={`${id}-summary`} aria-label="Public reasoning summary" className="select" value={modelOptionValue(value.reasoningSummary)}
      onValueChange={selected => onChange({ ...value, reasoningSummary: parseModelOption(selected) as NativeReasoningSummary | null })} disabled={disabled || profile?.available === false}
      options={[{ value: OMIT_MODEL_OPTION, label: 'Codex default' }, ...REASONING_SUMMARIES.map(summary => ({ value: summary, label: summary === 'none' ? 'Off' : summary }))]} />
    <p className="field-help">Choose how much public reasoning summary Codex requests.</p>
  </div></div>;
}
