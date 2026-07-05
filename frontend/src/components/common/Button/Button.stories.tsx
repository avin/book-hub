import { Plus } from "lucide-solid";
import Button from "./Button";

export default { component: Button };

export const Default = () => (
  <div style={{ display: "flex", gap: "12px", "align-items": "center", "flex-wrap": "wrap" }}>
    <Button>Primary</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="ghost">Ghost</Button>
    <Button variant="danger">Danger</Button>
    <Button iconStart={<Plus />}>With icon</Button>
    <Button variant="secondary" iconStart={<Plus />} iconOnly aria-label="Add" />
    <Button variant="link">Inline link button</Button>
    <Button loading>Loading</Button>
  </div>
);
