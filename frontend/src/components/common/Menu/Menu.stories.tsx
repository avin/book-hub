import { Check } from "lucide-solid";
import Menu, { MenuItem } from "./Menu";

export default { component: Menu };

const items: MenuItem[] = [
  { type: "category", label: "View", items: [{ label: "Library", selected: true, iconEnd: <Check /> }] },
  { type: "separator" },
  { label: "Settings" },
];

export const Default = () => <Menu items={items} />;
