import { createSignal } from 'solid-js';
import RangeInput from './RangeInput';

export default { component: RangeInput };

export const Default = () => {
  const [value, setValue] = createSignal(8);
  return (
    <RangeInput
      min={2}
      max={32}
      value={value()}
      aria-label="Боковые отступы"
      onInput={(event) => setValue(event.currentTarget.valueAsNumber)}
    />
  );
};
