import { MemoryRouter, Route } from '@solidjs/router';
import type { Decorator } from 'storybook-solidjs-vite';

export const withSolidRouter: Decorator = (Story) => (
  <MemoryRouter>
    <Route path="*" component={() => <Story />} />
  </MemoryRouter>
);
