import type { Preview } from 'storybook-solidjs-vite';
import '../src/styles/app.scss';
import { withSolidRouter } from './withSolidRouter';

const preview: Preview = {
  decorators: [withSolidRouter],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
