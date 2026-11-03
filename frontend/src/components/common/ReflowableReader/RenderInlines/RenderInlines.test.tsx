import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import RenderInlines from './RenderInlines';

afterEach(cleanup);

it('не создаёт исполняемую ссылку из содержимого книги', () => {
  const view = render(() => (
    <RenderInlines
      inlines={[
        {
          kind: 'link',
          href: 'javascript:alert(1)',
          children: [{ kind: 'text', text: 'Опасная' }],
        },
        {
          kind: 'link',
          href: 'https://example.com',
          children: [{ kind: 'text', text: 'Обычная' }],
        },
      ]}
      imageSrc={() => undefined}
      onInternalLink={() => undefined}
      onFootnoteLink={() => undefined}
      isFootnoteTarget={() => false}
    />
  ));

  expect(view.getByText('Опасная').getAttribute('href')).toBeNull();
  expect(view.getByRole('link', { name: 'Обычная' }).getAttribute('href')).toBe(
    'https://example.com',
  );
});
