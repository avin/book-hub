import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import { I18nProvider } from "@/i18n/I18nProvider";
import TagsSelect from "./TagsSelect";

export default { component: TagsSelect };

export const Default = () => {
  const [value, setValue] = createSignal(["fiction"]);
  const queryClient = new QueryClient();
  const tags = ["fiction", "history", "programming", "pdf", "favorites"];

  const searchOptions = async (query: string) => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return tags;
    }

    return tags.filter((tag) => tag.toLowerCase().includes(normalizedQuery));
  };

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <div style={{ width: "380px" }}>
          <TagsSelect
            value={value()}
            onChange={setValue}
            onSearchOptions={searchOptions}
          />
        </div>
      </I18nProvider>
    </QueryClientProvider>
  );
};
