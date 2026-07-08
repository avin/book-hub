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

export const AsLink = () => (
  <div style={{ display: "flex", gap: "12px", "align-items": "center", "flex-wrap": "wrap", width: "320px" }}>
    <Button href="/upload" iconStart={<Plus />}>
      Upload book
    </Button>
    <Button href="/library" variant="secondary">
      Library
    </Button>
    <Button href="/settings" variant="ghost" size="sm" iconOnly iconStart={<Plus />} aria-label="Settings" />
    <Button href="https://example.com" variant="link" target="_blank" rel="noreferrer">
      External link
    </Button>
    <Button href="/upload" fullWidth>
      Full width link
    </Button>
  </div>
);
