import { type JSX, Show } from "solid-js";
import styles from "./SettingRow.module.scss";

function SettingRow(props: { label: string; value?: string; children: JSX.Element }) {
  return (
    <div class={styles.settingRow}>
      <span>
        {props.label}
        <Show when={props.value}>
          <b>{props.value}</b>
        </Show>
      </span>
      {props.children}
    </div>
  );
}

export default SettingRow;
