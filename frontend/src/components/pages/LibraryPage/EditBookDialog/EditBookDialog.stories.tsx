import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import type { Book } from "@/api/books";
import { I18nProvider } from "@/i18n/I18nProvider";
import EditBookDialog from "./EditBookDialog";

export default { component: EditBookDialog };

const sampleBook: Book = {
  id: "00000000-0000-4000-8000-000000000003",
  title: "Editable Book",
  tags: ["fiction", "favorite"],
  favorite: true,
  format: "fb2",
  size_bytes: 980000,
  progress_percent: 18,
  created_at: "2026-07-05T12:00:00Z",
  last_opened_at: "2026-07-05T12:00:00Z",
  updated_at: "2026-07-05T12:00:00Z",
};

export const Default = () => {
  const queryClient = new QueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <EditBookDialog
          book={sampleBook}
          tagOptions={["fiction", "favorite", "history", "programming"]}
          onClose={() => undefined}
        />
      </I18nProvider>
    </QueryClientProvider>
  );
};
