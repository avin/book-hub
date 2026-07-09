import { createSignal } from 'solid-js';
import Button from '@/components/common/Button/Button';
import Dropdown from './Dropdown';

export default { component: Dropdown };

export const Default = () => {
  const [open, setOpen] = createSignal(false);

  return (
    <Dropdown
      open={open()}
      onOpenChange={setOpen}
      trigger={<Button onClick={() => setOpen(!open())}>Open</Button>}
    >
      <div style={{ padding: '12px', width: '220px' }}>Dropdown content</div>
    </Dropdown>
  );
};
