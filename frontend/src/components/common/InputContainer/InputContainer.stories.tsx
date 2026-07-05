import InputContainer from "./InputContainer";
import TextInput from "@/components/common/TextInput/TextInput";

export default { component: InputContainer };

export const Default = () => (
  <div style={{ display: "grid", gap: "16px", width: "360px" }}>
    <InputContainer label="Login" subtext="Use letters, digits, dot, dash or underscore">
      <TextInput id="login" placeholder="Login" />
    </InputContainer>
    <InputContainer label="Password" error="Required field">
      <TextInput id="password" type="password" placeholder="Password" invalid />
    </InputContainer>
  </div>
);
