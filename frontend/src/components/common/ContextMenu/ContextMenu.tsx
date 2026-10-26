import { type JSX } from 'solid-js';
import Dropdown from '@/components/common/Dropdown/Dropdown';
import { type createContextMenu } from './createContextMenu';

function ContextMenu(props: {
  controller: ReturnType<typeof createContextMenu>;
  children: JSX.Element;
  minWidth?: number;
}) {
  return (
    <Dropdown
      open={props.controller.position() !== null}
      onOpenChange={(open) => {
        if (!open) props.controller.close();
      }}
      placement="bottom-start"
      minWidth={props.minWidth}
      referenceStyle={{
        position: 'fixed',
        left: `${props.controller.position()?.x ?? 0}px`,
        top: `${props.controller.position()?.y ?? 0}px`,
        width: '1px',
        height: '1px',
        'pointer-events': 'none',
      }}
      trigger={<span aria-hidden="true" />}
    >
      {props.children}
    </Dropdown>
  );
}

export default ContextMenu;
