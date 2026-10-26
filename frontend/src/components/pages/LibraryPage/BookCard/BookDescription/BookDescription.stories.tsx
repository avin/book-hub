import { I18nProvider } from '@/i18n/I18nProvider';
import BookDescription from './BookDescription';

export default { component: BookDescription };

export const Default = () => (
  <I18nProvider>
    <div style={{ width: '360px' }}>
      <BookDescription text={'Книга о проектировании приложений для чтения. '.repeat(12)} />
    </div>
  </I18nProvider>
);
