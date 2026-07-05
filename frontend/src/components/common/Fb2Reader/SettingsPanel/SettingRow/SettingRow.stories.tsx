import SettingRow from "./SettingRow";

export default { component: SettingRow };

export const Default = () => (
  <div style={{ width: "320px" }}>
    <SettingRow label="Размер" value="18px">
      <input type="range" min="14" max="30" value="18" />
    </SettingRow>
  </div>
);
