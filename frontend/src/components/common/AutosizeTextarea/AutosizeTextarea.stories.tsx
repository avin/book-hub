import { createSignal } from 'solid-js';
import AutosizeTextarea from './AutosizeTextarea';

export default { component: AutosizeTextarea };

export const Default = () => {
  const [value, setValue] = createSignal('');
  return (
    <div style={{ width: '320px' }}>
      <AutosizeTextarea
        aria-label="Описание"
        value={value()}
        onInput={setValue}
        maxLength={10000}
      />
    </div>
  );
};

export const Prefilled = () => {
  const [value, setValue] = createSignal('Первая строка\nВторая строка\nТретья строка');
  return (
    <div style={{ width: '320px' }}>
      <AutosizeTextarea
        aria-label="Описание"
        value={value()}
        onInput={setValue}
        maxLength={10000}
      />
    </div>
  );
};
